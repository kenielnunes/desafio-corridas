import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import amqp, { type ChannelModel, type ConfirmChannel } from 'amqplib';
import { Redis } from 'ioredis';
import { type Collection, MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const API = process.env.API_URL ?? 'http://localhost:3000';
const RABBITMQ_URL = process.env.RABBITMQ_URL ?? 'amqp://corridas:corridas_dev@localhost:5672';
const MONGO_URL =
  process.env.MONGO_URL ?? 'mongodb://corridas:corridas_dev@localhost:27017/?authSource=admin';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://:redis_dev@localhost:6379';

const token = (name: string) =>
  readFileSync(new URL(`../../auth-dev/tokens/${name}.jwt`, import.meta.url), 'utf8').trim();

let connection: ChannelModel;
let channel: ConfirmChannel;
let mongo: MongoClient;
let redis: Redis;
let history: Collection<{ _id: string; rideId: string; type: string; status: string }>;

beforeAll(async () => {
  connection = await amqp.connect(RABBITMQ_URL);
  channel = await connection.createConfirmChannel();
  mongo = await MongoClient.connect(MONGO_URL);
  history = mongo.db('corridas').collection('ride_history');
  redis = new Redis(REDIS_URL);
});

afterAll(async () => {
  await connection.close();
  await mongo.close();
  redis.disconnect();
});

const publish = (content: Buffer, routingKey = 'corrida.criada') =>
  new Promise<void>((confirmed, failed) =>
    channel.publish('rides', routingKey, content, { persistent: true }, (error) =>
      error ? failed(error) : confirmed(),
    ),
  );

async function waitFor<T>(read: () => Promise<T | null | undefined>, timeoutMs = 10_000) {
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; await sleep(100)) {
    const value = await read();
    if (value) return value;
  }
  throw new Error(`condição não atingida em ${timeoutMs} ms`);
}

async function callApi(method: string, path: string, person: string, body?: unknown) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token(person)}`,
      'idempotency-key': randomUUID(),
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path} respondeu ${response.status}`);
  return response.json();
}

async function readThroughApi(id: string) {
  const response = await fetch(`${API}/corridas/${id}`, {
    headers: { authorization: `Bearer ${token('passageiro-6')}` },
  });
  return { ...(await response.json()), cache: response.headers.get('x-cache') };
}

async function cachedVersion(rideId: string) {
  const value = await redis.get(`ride:${rideId}`);
  return value ? (JSON.parse(value) as { version: number }).version : null;
}

function testEvent() {
  const now = new Date().toISOString();
  return {
    eventId: randomUUID(),
    type: 'corrida.criada',
    occurredAt: now,
    ride: {
      id: randomUUID(),
      passengerId: 'passageiro-teste',
      driverId: null,
      origin: 'Centro',
      destination: 'Barra da Tijuca',
      status: 'requested',
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
  };
}

function versionsOfRide(id: string) {
  const statuses = ['requested', 'accepted', 'in_progress'] as const;
  return statuses.map((status, index) => {
    const event = testEvent();
    return {
      ...event,
      type: index === 0 ? 'corrida.criada' : 'corrida.status_alterado',
      ride: { ...event.ride, id, status, version: index + 1 },
    };
  });
}

const messagesInDlq = async () => (await channel.checkQueue('rides.worker.dlq')).messageCount;

describe('worker', { timeout: 30_000 }, () => {
  it('a mesma mensagem entregue duas vezes gera um registro só, sem ir para a DLQ', async () => {
    const dlqBefore = await messagesInDlq();
    const event = testEvent();
    const content = Buffer.from(JSON.stringify(event));

    await publish(content);
    await publish(content);
    await waitFor(() => history.findOne({ _id: event.eventId }));
    await sleep(500);

    expect(await history.countDocuments({ _id: event.eventId })).toBe(1);
    expect(await messagesInDlq()).toBe(dlqBefore);
  });

  it('mensagem inválida vai direto para a DLQ', async () => {
    const dlqBefore = await messagesInDlq();
    await publish(Buffer.from('isto não é um evento'));
    await waitFor(async () => (await messagesInDlq()) > dlqBefore);
  });

  it('rajada de versões da mesma corrida, em ordem ou invertida, termina na versão mais nova', async () => {
    const rides = Array.from({ length: 40 }, () => randomUUID());
    for (const [index, id] of rides.entries()) {
      const versions = versionsOfRide(id);
      for (const event of index % 2 === 0 ? versions : versions.reverse()) {
        await publish(Buffer.from(JSON.stringify(event)), event.type);
      }
    }
    await waitFor(async () => {
      const versions = await Promise.all(rides.map(cachedVersion));
      return versions.every((version) => version === 3);
    });
  });

  it('evento antigo entregue depois não faz o status voltar no cache', async () => {
    const created = await callApi('POST', '/corridas', 'passageiro-6', {
      origin: 'Centro',
      destination: 'Barra da Tijuca',
    });
    await callApi('PATCH', `/corridas/${created.id}/status`, 'motorista-2', {
      status: 'accepted',
    });
    await waitFor(async () => {
      const read = await readThroughApi(created.id);
      return read.status === 'accepted' && read.cache === 'HIT';
    });

    const late = {
      eventId: randomUUID(),
      type: 'corrida.criada',
      occurredAt: created.createdAt,
      ride: created,
    };
    await publish(Buffer.from(JSON.stringify(late)));
    await waitFor(() => history.findOne({ _id: late.eventId }));

    expect(await cachedVersion(created.id)).toBe(2);
    expect(await readThroughApi(created.id)).toMatchObject({
      status: 'accepted',
      version: 2,
      cache: 'HIT',
    });
  });

  it('corrida criada pela API chega ao histórico pelo worker', async () => {
    const created = await callApi('POST', '/corridas', 'passageiro-6', {
      origin: 'Centro',
      destination: 'Barra da Tijuca',
    });
    const record = await waitFor(() => history.findOne({ rideId: created.id }));
    expect(record).toMatchObject({ type: 'corrida.criada', status: 'requested' });
  });
});
