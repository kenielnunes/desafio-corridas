import { z } from 'zod';

const env = z
  .object({
    RABBITMQ_URL: z.url(),
    MONGO_URL: z.url(),
    REDIS_URL: z.url(),
    CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    HTTP_PORT: z.coerce.number().int().positive().default(9464),
    PREFETCH: z.coerce.number().int().positive().default(10),
  })
  .parse(process.env);

export const config = {
  rabbitmqUrl: env.RABBITMQ_URL,
  mongoUrl: env.MONGO_URL,
  redisUrl: env.REDIS_URL,
  cacheTtlSeconds: env.CACHE_TTL_SECONDS,
  httpPort: env.HTTP_PORT,
  prefetch: env.PREFETCH,
};
