import type { NextFunction, Request, Response } from 'express';
import { httpDuration, httpRequests } from './metrics.js';

export const INTERNAL_PATHS = /^\/(health|metrics)\b/i;

// O nestjs-pino monta o próprio middleware nesta rota curinga; numa rota inexistente, é ela que
// fica em request.route.
const LOGGER_ROUTE = '{/*splat}';

// Middleware e não interceptor: os interceptors do Nest rodam depois dos guards, e um 401 ou 403
// devolvido pelo guard ficaria fora da métrica.
export function measureHttp(request: Request, response: Response, next: NextFunction) {
  if (INTERNAL_PATHS.test(request.path)) return next();
  const stop = httpDuration.startTimer();
  response.on('finish', () => {
    // A rota entra como template (/corridas/:id), nunca com o id: cada valor diferente de label
    // vira uma série nova no Prometheus.
    const route: string | undefined = request.route?.path;
    const labels = {
      method: request.method,
      route: route && route !== LOGGER_ROUTE ? route : 'unmatched',
      status_code: String(response.statusCode),
    };
    stop(labels);
    httpRequests.inc(labels);
  });
  next();
}
