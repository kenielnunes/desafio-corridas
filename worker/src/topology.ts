import type { Channel } from 'amqplib';

export const EXCHANGE = 'rides';
export const DEAD_LETTER_EXCHANGE = 'rides.dlx';
export const QUEUE = 'rides.worker';
export const DEAD_LETTER_QUEUE = 'rides.worker.dlq';

export async function declareTopology(channel: Channel) {
  await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
  await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'fanout', { durable: true });

  await channel.assertQueue(QUEUE, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
      'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE,
      'x-delivery-limit': 10,
      'x-delayed-retry-type': 'failed',
      'x-delayed-retry-min': 1_000,
      'x-delayed-retry-max': 10_000,
    },
  });
  await channel.bindQueue(QUEUE, EXCHANGE, 'corrida.*');

  await channel.assertQueue(DEAD_LETTER_QUEUE, {
    durable: true,
    arguments: { 'x-queue-type': 'quorum' },
  });
  await channel.bindQueue(DEAD_LETTER_QUEUE, DEAD_LETTER_EXCHANGE, '');
}
