import { z } from 'zod';

export const RideEventSchema = z.object({
  eventId: z.uuid(),
  type: z.enum(['corrida.criada', 'corrida.status_alterado']),
  occurredAt: z.iso.datetime(),
  ride: z.object({
    id: z.uuid(),
    passengerId: z.string().min(1),
    driverId: z.string().min(1).nullable(),
    origin: z.string(),
    destination: z.string(),
    status: z.enum(['requested', 'accepted', 'in_progress', 'finished']),
    version: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  }),
});

export type RideEvent = z.infer<typeof RideEventSchema>;
