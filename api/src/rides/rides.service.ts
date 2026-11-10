import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { User } from '../auth/user.js';
import { EventPublisher } from '../events/publisher.js';
import { Prisma, type Ride } from '../generated/prisma/client.js';
import { cacheReads } from '../observability/metrics.js';
import { PrismaService } from '../prisma.service.js';
import { RideCache } from './cache.js';
import {
  canRead,
  previousStatus,
  rejectionReason,
  requiresAssignedDriver,
  type TargetStatus,
} from './rules.js';
import type { CreateRide } from './schemas.js';

export const toResponse = (ride: Ride) => ({
  id: ride.id,
  passengerId: ride.passengerId,
  driverId: ride.driverId,
  origin: ride.origin,
  destination: ride.destination,
  status: ride.status,
  version: ride.version,
  createdAt: ride.createdAt.toISOString(),
  updatedAt: ride.updatedAt.toISOString(),
});

export type RideResponse = ReturnType<typeof toResponse>;

function listFilter(user: User, available: boolean, active: boolean) {
  if (user.role === 'passageiro') return { passengerId: user.id };
  if (available) return { status: 'requested' as const };
  return active
    ? { driverId: user.id, status: { in: ['accepted' as const, 'in_progress' as const] } }
    : { driverId: user.id };
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

@Injectable()
export class RidesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventPublisher,
    private readonly cache: RideCache,
  ) {}

  async create(
    passengerId: string,
    idempotencyKey: string,
    data: CreateRide,
    correlationId: string,
  ) {
    try {
      const ride = toResponse(
        await this.prisma.ride.create({ data: { passengerId, idempotencyKey, ...data } }),
      );
      await this.events.publish('corrida.criada', ride, correlationId);
      return { ride, replayed: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.prisma.ride.findUniqueOrThrow({
        where: { passengerId_idempotencyKey: { passengerId, idempotencyKey } },
      });
      return { ride: toResponse(existing), replayed: true };
    }
  }

  async get(user: User, id: string) {
    const cached = await this.readFromCache(id);
    const ride = cached ?? (await this.readFromDatabase(id));
    if (!canRead(ride, user)) throw new ForbiddenException('sem acesso a esta corrida');
    return { ride, source: cached ? ('HIT' as const) : ('MISS' as const) };
  }

  async list(user: User, filter: { available: boolean; active: boolean; limit: number }) {
    const rides = await this.prisma.ride.findMany({
      where: listFilter(user, filter.available, filter.active),
      orderBy: { createdAt: 'desc' },
      take: filter.limit,
    });
    return rides.map(toResponse);
  }

  async updateStatus(driverId: string, id: string, target: TargetStatus, correlationId: string) {
    const onlyAssignedDriver = requiresAssignedDriver(target) ? { driverId } : {};
    // A leitura fica na mesma transação do UPDATE: a linha segue travada até o commit, então o
    // retrato publicado é o desta mudança, e não o de uma mudança concorrente logo em seguida.
    const updated = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.ride.updateMany({
        where: { id, status: previousStatus(target), ...onlyAssignedDriver },
        data: {
          status: target,
          version: { increment: 1 },
          ...(target === 'accepted' ? { driverId } : {}),
        },
      });
      return count === 1 ? tx.ride.findUniqueOrThrow({ where: { id } }) : null;
    });

    if (updated) {
      const response = toResponse(updated);
      await this.cache.invalidate(id).catch(() => undefined);
      await this.events.publish('corrida.status_alterado', response, correlationId);
      return response;
    }

    const ride = await this.prisma.ride.findUnique({ where: { id } });
    if (!ride) throw new NotFoundException('corrida não encontrada');
    if (rejectionReason(ride, driverId, target) === 'other_driver') {
      throw new ForbiddenException('a corrida é de outro motorista');
    }
    const canSeeStatus = canRead(ride, { id: driverId, role: 'motorista' });
    throw new ConflictException(
      canSeeStatus
        ? `não é possível passar de ${ride.status} para ${target}`
        : 'mudança de status não permitida',
    );
  }

  private async readFromCache(id: string) {
    try {
      const ride = await this.cache.get(id);
      cacheReads.inc({ result: ride ? 'hit' : 'miss' });
      return ride;
    } catch {
      cacheReads.inc({ result: 'error' });
      return null;
    }
  }

  private async readFromDatabase(id: string) {
    const found = await this.prisma.ride.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('corrida não encontrada');
    const ride = toResponse(found);
    await this.cache.fill(ride).catch(() => undefined);
    return ride;
  }
}
