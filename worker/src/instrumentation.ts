// Carregado com `node --import`, antes do worker: as instrumentações precisam estar ativas quando
// os pacotes forem importados. Sem OTEL_EXPORTER_OTLP_ENDPOINT, nada é instrumentado.
import { register, supportsSyncHooks } from 'import-in-the-middle/register-hooks.mjs';

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  if (supportsSyncHooks()) register({ include: ['amqplib', 'ioredis', 'mongodb', 'pino'] });
  const { startTelemetry } = await import('./telemetry.js');
  startTelemetry();
}
