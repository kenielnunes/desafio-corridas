import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import amqp, { type ConsumeMessage } from 'amqplib';
import { pino } from 'pino';
import { RideCache } from './cache.js';
import { config } from './config.js';
import { RideHistory } from './history.js';
import { processMessage } from './processor.js';
import { declareTopology, QUEUE } from './topology.js';

const log = pino({ base: { service: 'worker' } });

const history = await RideHistory.connect(config.mongoUrl);
const cache = RideCache.connect(config.redisUrl, config.cacheTtlSeconds);
const connection = await amqp.connect(config.rabbitmqUrl);
const channel = await connection.createChannel();
await declareTopology(channel);
await channel.prefetch(config.prefetch);

// Sem reconexão automática de propósito: se a conexão cair, o processo sai e o Docker o reinicia.
// As mensagens sem ack voltam para a fila, e o processamento é idempotente.
connection.on('error', (err) => log.error({ err }, 'erro na conexão com o RabbitMQ'));
connection.on('close', () => {
  log.error('conexão com o RabbitMQ fechada; encerrando para o Docker reiniciar');
  process.exit(1);
});

let inFlight = 0;
let ready = false;

async function handle(message: ConsumeMessage | null) {
  if (!message) return;
  inFlight++;
  try {
    const { result, event, error } = await processMessage(message.content, {
      recordHistory: (e) => history.record(e),
      updateCache: (ride) => cache.update(ride),
    });

    if (result === 'processed' || result === 'duplicate') channel.ack(message);
    else channel.reject(message, result === 'failed');

    const context = {
      result,
      type: event?.type,
      eventId: event?.eventId,
      rideId: event?.ride.id,
    };
    if (result === 'failed') {
      log.warn({ ...context, err: error }, 'falhou; o RabbitMQ vai reentregar');
    } else if (result === 'invalid') {
      log.warn(context, 'mensagem inválida enviada para a DLQ');
    } else {
      log.info(context, 'evento processado');
    }
  } finally {
    inFlight--;
  }
}

const { consumerTag } = await channel.consume(QUEUE, (message) => void handle(message));
ready = true;
log.info({ queue: QUEUE, prefetch: config.prefetch }, 'worker consumindo');

function statusFor(url: string | undefined) {
  if (url === '/health/live') return 200;
  if (url === '/health/ready') return ready ? 200 : 503;
  return 404;
}

const server = createServer((request, response) => {
  const status = statusFor(request.url);
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ status: status === 200 ? 'ok' : 'unavailable' }));
}).listen(config.httpPort);

async function shutdown(signal: string) {
  log.info({ signal }, 'parando de consumir e terminando as mensagens em andamento');
  ready = false;
  await channel.cancel(consumerTag);
  while (inFlight > 0) await sleep(50);
  connection.removeAllListeners('close');
  await connection.close();
  await history.close();
  await cache.close();
  server.close();
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
