import type { Request } from 'express';
import { z } from 'zod';

export const ROLES = ['passageiro', 'motorista'] as const;
export type Role = (typeof ROLES)[number];

export type User = { id: string; role: Role };

export type AuthenticatedRequest = Request & { user?: User };

export const ClaimsSchema = z.object({
  sub: z.string().min(1).max(64),
  role: z.enum(ROLES),
});
