import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export const CreateRideSchema = z.object({
  origin: z.string().trim().min(3).max(200),
  destination: z.string().trim().min(3).max(200),
});
export type CreateRide = z.infer<typeof CreateRideSchema>;

export const UpdateStatusSchema = z.object({
  status: z.enum(['accepted', 'in_progress', 'finished']),
});
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;

export const ListRidesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
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
