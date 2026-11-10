// Carregado com `node --import`, antes da aplicação: as instrumentações precisam estar ativas quando
// os pacotes forem importados. Sem OTEL_EXPORTER_OTLP_ENDPOINT, nada é instrumentado.
import { register, supportsSyncHooks } from 'import-in-the-middle/register-hooks.mjs';

if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  // Só pacotes importados por código ESM (o nosso e o do Nest 12) precisam deste hook; os que são
  // carregados por require, como o pino dentro do nestjs-pino, já são alcançados sem ele.
  if (supportsSyncHooks()) register({ include: ['amqplib', 'express', 'ioredis'] });
  const { startTelemetry } = await import('./telemetry.js');
  startTelemetry();
}
