import type { NextFunction, Request, Response } from 'express';
import { httpDuration, httpRequests } from './metrics.js';

const NOT_MEASURED = /^\/(health|metrics)\b/;

// Middleware e não interceptor: os interceptors do Nest rodam depois dos guards, e um 401 ou 403
// devolvido pelo guard ficaria fora da métrica.
export function measureHttp(request: Request, response: Response, next: NextFunction) {
  if (NOT_MEASURED.test(request.path)) return next();
  const stop = httpDuration.startTimer();
  response.on('finish', () => {
    // A rota entra como template (/corridas/:id), nunca com o id: cada valor diferente de label
    // vira uma série nova no Prometheus.
    const labels = {
      method: request.method,
      route: request.route?.path ?? 'unmatched',
      status_code: String(response.statusCode),
    };
    stop(labels);
    httpRequests.inc(labels);
  });
  next();
}
