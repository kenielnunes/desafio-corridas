import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { AmqplibInstrumentation } from '@opentelemetry/instrumentation-amqplib';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { NodeSDK } from '@opentelemetry/sdk-node';

export function startTelemetry() {
  new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    textMapPropagator: new W3CTraceContextPropagator(),
    instrumentations: [
      new AmqplibInstrumentation(),
      new MongoDBInstrumentation(),
      // Só o nome do comando: os argumentos do EVAL levariam a corrida inteira ao Jaeger.
      new IORedisInstrumentation({ dbStatementSerializer: (command) => command }),
      new PinoInstrumentation(),
    ],
  }).start();
}
