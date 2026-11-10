import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { type Dependencies, processMessage } from './processor.js';

const now = new Date().toISOString();

const event = () => ({
  eventId: randomUUID(),
  type: 'corrida.criada',
  occurredAt: now,
  ride: {
    id: randomUUID(),
    passengerId: 'passageiro-1',
    driverId: null,
    origin: 'Centro',
    destination: 'Barra da Tijuca',
    status: 'requested',
    version: 1,
    createdAt: now,
    updatedAt: now,
  },
});

const message = (value: unknown) => Buffer.from(JSON.stringify(value));

const historyReturning = (answer: 'new' | 'duplicate'): Dependencies => ({
  recordHistory: async () => answer,
  updateCache: async () => 'updated',
});

describe('processMessage', () => {
  it('evento novo é processado', async () => {
    const { result } = await processMessage(message(event()), historyReturning('new'));
    expect(result).toBe('processed');
  });

  it('evento repetido é reconhecido como duplicado, sem erro', async () => {
    const { result } = await processMessage(message(event()), historyReturning('duplicate'));
    expect(result).toBe('duplicate');
  });

  it('JSON quebrado é inválido', async () => {
    const { result } = await processMessage(Buffer.from('{quebrado'), historyReturning('new'));
    expect(result).toBe('invalid');
  });

  it('JSON fora do contrato é inválido', async () => {
    const { result } = await processMessage(
      message({ ...event(), type: 'corrida.desconhecida' }),
      historyReturning('new'),
    );
    expect(result).toBe('invalid');
  });

  it('erro de infraestrutura vira falha, para o RabbitMQ reentregar', async () => {
    const { result } = await processMessage(message(event()), {
      recordHistory: async () => {
        throw new Error('Mongo fora do ar');
      },
      updateCache: async () => 'updated',
    });
    expect(result).toBe('failed');
  });

  it('evento duplicado ainda atualiza o cache, para completar o que uma queda deixou pela metade', async () => {
    const updates: unknown[] = [];
    await processMessage(message(event()), {
      recordHistory: async () => 'duplicate',
      updateCache: async (ride) => updates.push(ride),
    });
    expect(updates).toHaveLength(1);
  });
});
