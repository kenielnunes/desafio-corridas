import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import amqp, { type ChannelModel, type ConfirmChannel } from 'amqplib';
import { config } from '../config.js';
import type { RideResponse } from '../rides/rides.service.js';

export type EventType = 'corrida.criada' | 'corrida.status_alterado';

const EXCHANGE = 'rides';
const ESPERA_MAXIMA_CONFIRMACAO_MS = 2_000;

type Connection = { model: ChannelModel; channel: ConfirmChannel };

@Injectable()
export class EventPublisher implements OnModuleDestroy {
  private readonly logger = new Logger(EventPublisher.name);
  private connection?: Promise<Connection>;

  // Sem outbox: o evento sai depois do commit no MySQL. Se o RabbitMQ estiver fora, a corrida
  // continua criada e o evento se perde (registrado no LIMITES); por isso o erro não sobe.
  async publish(type: EventType, ride: RideResponse): Promise<void> {
    const event = { eventId: randomUUID(), type, occurredAt: new Date().toISOString(), ride };
    try {
      const { channel } = await this.connect();
      await withTimeout(
        new Promise<void>((confirmed, failed) =>
          channel.publish(
            EXCHANGE,
            type,
            Buffer.from(JSON.stringify(event)),
            {
              persistent: true,
              messageId: event.eventId,
              type: type,
              contentType: 'application/json',
            },
            (error) => (error ? failed(error) : confirmed()),
          ),
        ),
        ESPERA_MAXIMA_CONFIRMACAO_MS,
      );
    } catch (error) {
      this.connection = undefined;
      this.logger.error(`evento ${type} da corrida ${ride.id} não publicado: ${String(error)}`);
    }
  }

  async onModuleDestroy() {
    const connection = await this.connection?.catch(() => undefined);
    await connection?.model.close().catch(() => undefined);
  }

  private connect(): Promise<Connection> {
    this.connection ??= (async () => {
      const model = await amqp.connect(config.rabbitmqUrl);
      model.on('error', (error) => this.logger.error(`conexão com o RabbitMQ: ${String(error)}`));
      model.on('close', () => (this.connection = undefined));
      const channel = await model.createConfirmChannel();
      channel.on('error', () => void model.close().catch(() => undefined));
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      return { model, channel };
    })();
    return this.connection;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, failed) =>
      setTimeout(() => failed(new Error(`sem confirmação do broker em ${ms} ms`)), ms).unref(),
    ),
  ]);
}
