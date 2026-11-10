import { collectDefaultMetrics, Counter, Histogram, register } from 'prom-client';

register.setDefaultLabels({ service: 'corridas-api' });
collectDefaultMetrics();

export const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'Requisições HTTP atendidas pela API',
  labelNames: ['method', 'route', 'status_code'] as const,
});

export const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Tempo de resposta da API',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});

export const cacheReads = new Counter({
  name: 'cache_reads_total',
  help: 'Leituras de corrida no cache, por resultado',
  labelNames: ['result'] as const,
});

export const eventsPublished = new Counter({
  name: 'events_published_total',
  help: 'Eventos publicados no RabbitMQ, por resultado',
  labelNames: ['event_type', 'result'] as const,
});

export { register };
