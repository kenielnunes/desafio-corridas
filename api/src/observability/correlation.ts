import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// O id vindo do cliente só é aceito se for um UUID: qualquer outro texto iria parar nos logs.
export function correlationIdFor(request: IncomingMessage, response: ServerResponse) {
  const received = request.headers['x-correlation-id'];
  const id = typeof received === 'string' && UUID.test(received) ? received : randomUUID();
  response.setHeader('X-Correlation-Id', id);
  return id;
}

// Registrado antes do body parser: uma requisição recusada por ele (JSON quebrado, corpo grande)
// nunca chega ao pino-http, mas ainda devolve o id. O pino-http reaproveita o request.id.
export function assignCorrelationId(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) {
  request.id = correlationIdFor(request, response);
  next();
}

export const CorrelationId = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  String(context.switchToHttp().getRequest<IncomingMessage>().id),
);
