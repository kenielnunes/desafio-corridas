import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const Address = z
  .string()
  .trim()
  .min(3)
  .max(200)
  .regex(/[\p{L}\p{N}]/u, 'precisa ter letras ou números');

export const CreateRideSchema = z.object({
  origin: Address,
  destination: Address,
});
export type CreateRide = z.infer<typeof CreateRideSchema>;

export const UpdateStatusSchema = z.object({
  status: z.enum(['accepted', 'in_progress', 'finished']),
});
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;

export const ListRidesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  available: z.stringbool().default(false),
  active: z.stringbool().default(false),
});
export type ListRides = z.infer<typeof ListRidesSchema>;

export const RideIdSchema = z.uuid();

const IdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9_-]{8,100}$/);

export function parseIdempotencyKey(value: string | undefined): string {
  const result = IdempotencyKeySchema.safeParse(value);
  if (!result.success) {
    throw new BadRequestException(
      'header Idempotency-Key obrigatório: de 8 a 100 caracteres entre letras, números, _ e -',
    );
  }
  return result.data;
}
