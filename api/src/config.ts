import { readFileSync } from 'node:fs';
import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  DATABASE_POOL_SIZE: z.coerce.number().int().positive().default(10),
  RABBITMQ_URL: z.url(),
  REDIS_URL: z.url(),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  JWT_PUBLIC_KEY_FILE: z.string().min(1),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  RATE_LIMIT_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_CREATES_PER_MINUTE: z.coerce.number().int().positive().default(10),
});

const env = EnvSchema.parse(process.env);

export const config = {
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  databasePoolSize: env.DATABASE_POOL_SIZE,
  rabbitmqUrl: env.RABBITMQ_URL,
  redisUrl: env.REDIS_URL,
  cacheTtlSeconds: env.CACHE_TTL_SECONDS,
  jwt: {
    publicKeyPem: readFileSync(env.JWT_PUBLIC_KEY_FILE, 'utf8'),
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  },
  rateLimit: {
    requestsPerMinute: env.RATE_LIMIT_REQUESTS_PER_MINUTE,
    createsPerMinute: env.RATE_LIMIT_CREATES_PER_MINUTE,
  },
};
