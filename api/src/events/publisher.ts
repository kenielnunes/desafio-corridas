import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import amqp, { type ChannelModel, type ConfirmChannel } from 'amqplib';
import { config } from '../config.js';
import { eventsPublished } from '../observability/metrics.js';
import type { RideResponse } from '../rides/rides.service.js';

export type EventType = 'corrida.criada' | 'corrida.status_alterado';

const EXCHANGE = 'rides';
const TIMEOUT_MS = 2_000;

type Connection = { model: ChannelModel; channel: ConfirmChannel };
type RideEvent = { eventId: string; type: EventType; occurredAt: string; ride: RideResponse };
type Message = { event: RideEvent; correlationId: string };

@Injectable()
export class EventPublisher implements OnModuleDestroy {
  private readonly logger = new Logger(EventPublisher.name);
  private connection?: Promise<Connection>;

  // Sem outbox: o evento sai depois do commit no MySQL. Se o RabbitMQ estiver fora, a corrida
  // continua criada e o evento se perde (registrado no LIMITES); por isso o erro não sobe.
  async publish(type: EventType, ride: RideResponse, correlationId: string): Promise<void> {
    const event = { eventId: randomUUID(), type, occurredAt: new Date().toISOString(), ride };
    try {
      await withTimeout(this.send({ event, correlationId }), TIMEOUT_MS);
      eventsPublished.inc({ event_type: type, result: 'ok' });
    } catch (error) {
      eventsPublished.inc({ event_type: type, result: 'failed' });
      this.dropConnection();
      this.logger.error(`evento ${type} da corrida ${ride.id} não publicado: ${String(error)}`);
    }
  }

  async onModuleDestroy() {
    const connection = await this.connection?.catch(() => undefined);
    await connection?.model.close().catch(() => undefined);
  }

  private async send({ event, correlationId }: Message) {
    const { channel } = await this.connect();
    await new Promise<void>((confirmed, failed) =>
      channel.publish(
        EXCHANGE,
        event.type,
        Buffer.from(JSON.stringify(event)),
        {
          persistent: true,
          messageId: event.eventId,
          correlationId,
          type: event.type,
          contentType: 'application/json',
        },
        (error) => (error ? failed(error) : confirmed()),
      ),
    );
  }

  private connect(): Promise<Connection> {
    if (this.connection) return this.connection;
    const connection: Promise<Connection> = (async () => {
      const model = await amqp.connect(config.rabbitmqUrl, { timeout: TIMEOUT_MS });
      model.on('error', (error) => this.logger.error(`conexão com o RabbitMQ: ${String(error)}`));
      model.on('close', () => {
        if (this.connection === connection) this.connection = undefined;
      });
      const channel = await model.createConfirmChannel();
      channel.on('error', () => void model.close().catch(() => undefined));
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      return { model, channel };
    })();
    this.connection = connection;
    return connection;
  }

  private dropConnection() {
    const connection = this.connection;
    this.connection = undefined;
    void connection?.then(({ model }) => model.close()).catch(() => undefined);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, failed) =>
      setTimeout(() => failed(new Error(`sem resposta do broker em ${ms} ms`)), ms).unref(),
    ),
  ]);
}
