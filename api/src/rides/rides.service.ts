import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { User } from '../auth/user.js';
import { Prisma, type Ride } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma.service.js';
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
  createdAt: ride.createdAt,
  updatedAt: ride.updatedAt,
});

function listFilter(user: User, available: boolean) {
  if (user.role === 'passageiro') return { passengerId: user.id };
  return available ? { status: 'requested' as const } : { driverId: user.id };
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

@Injectable()
export class RidesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(passengerId: string, idempotencyKey: string, data: CreateRide) {
    try {
      const ride = await this.prisma.ride.create({
        data: { passengerId, idempotencyKey, ...data },
      });
      return { ride: toResponse(ride), replayed: false };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const existing = await this.prisma.ride.findUniqueOrThrow({
        where: { passengerId_idempotencyKey: { passengerId, idempotencyKey } },
      });
      return { ride: toResponse(existing), replayed: true };
    }
  }

  async get(user: User, id: string) {
    const ride = await this.prisma.ride.findUnique({ where: { id } });
    if (!ride) throw new NotFoundException('corrida não encontrada');
    if (!canRead(ride, user)) throw new ForbiddenException('sem acesso a esta corrida');
    return toResponse(ride);
  }

  async list(user: User, available: boolean, limit: number) {
    const rides = await this.prisma.ride.findMany({
      where: listFilter(user, available),
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rides.map(toResponse);
  }

  async updateStatus(driverId: string, id: string, target: TargetStatus) {
    const onlyAssignedDriver = requiresAssignedDriver(target) ? { driverId } : {};
    const { count } = await this.prisma.ride.updateMany({
      where: { id, status: previousStatus(target), ...onlyAssignedDriver },
      data: {
        status: target,
        version: { increment: 1 },
        ...(target === 'accepted' ? { driverId } : {}),
      },
    });

    const ride = await this.prisma.ride.findUnique({ where: { id } });
    if (!ride) throw new NotFoundException('corrida não encontrada');
    if (count === 1) return toResponse(ride);
    if (rejectionReason(ride, driverId, target) === 'other_driver') {
      throw new ForbiddenException('a corrida é de outro motorista');
    }
    throw new ConflictException(`não é possível passar de ${ride.status} para ${target}`);
  }
}
