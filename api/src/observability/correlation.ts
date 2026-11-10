import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// O id vindo do cliente só é aceito se for um UUID: qualquer outro texto iria parar nos logs.
export function correlationIdFor(request: IncomingMessage, response: ServerResponse) {
  const received = request.headers['x-correlation-id'];
  const id = typeof received === 'string' && UUID.test(received) ? received : randomUUID();
  response.setHeader('X-Correlation-Id', id);
  return id;
}
