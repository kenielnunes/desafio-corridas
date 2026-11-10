import { collectDefaultMetrics, Counter, Histogram, register } from 'prom-client';

register.setDefaultLabels({ service: 'corridas-worker' });
collectDefaultMetrics();

export const messagesConsumed = new Counter({
  name: 'worker_messages_total',
  help: 'Mensagens consumidas pelo worker, por resultado',
  labelNames: ['event_type', 'result'] as const,
});

export const processingDuration = new Histogram({
  name: 'worker_processing_duration_seconds',
  help: 'Tempo para processar uma mensagem (MongoDB e Redis)',
  labelNames: ['result'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
});

export const eventLag = new Histogram({
  name: 'worker_event_lag_seconds',
  help: 'Tempo entre a mudança acontecer na API e o worker processar o evento',
  labelNames: ['event_type'] as const,
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 15, 60, 300],
});

export { register };
