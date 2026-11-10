import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { AmqplibInstrumentation } from '@opentelemetry/instrumentation-amqplib';
import { ExpressInstrumentation, ExpressLayerType } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PrismaInstrumentation } from '@prisma/instrumentation';

const NOT_TRACED = /^\/(health|metrics)\b/;

export function startTelemetry() {
  new NodeSDK({
    traceExporter: new OTLPTraceExporter(),
    // Só o traceparent: o baggage enviado pelo cliente seguiria na mensagem até o worker.
    textMapPropagator: new W3CTraceContextPropagator(),
    instrumentations: [
      new HttpInstrumentation({
        ignoreIncomingRequestHook: (request) => NOT_TRACED.test(request.url ?? ''),
      }),
      // Só para o span HTTP ganhar o nome da rota (POST /corridas); um span por middleware é ruído.
      new ExpressInstrumentation({
        ignoreLayersType: [ExpressLayerType.MIDDLEWARE, ExpressLayerType.REQUEST_HANDLER],
      }),
      new PrismaInstrumentation(),
      new IORedisInstrumentation(),
      new AmqplibInstrumentation(),
      new PinoInstrumentation(),
    ],
  }).start();
}
