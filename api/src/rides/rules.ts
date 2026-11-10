import type { User } from '../auth/user.js';

export type RideStatus = 'requested' | 'accepted' | 'in_progress' | 'finished';
export type TargetStatus = Exclude<RideStatus, 'requested'>;

const PREVIOUS_STATUS: Record<TargetStatus, RideStatus> = {
  accepted: 'requested',
  in_progress: 'accepted',
  finished: 'in_progress',
};

type RideForRules = { passengerId: string; driverId: string | null; status: RideStatus };

export function previousStatus(target: TargetStatus): RideStatus {
  return PREVIOUS_STATUS[target];
}

export function requiresAssignedDriver(target: TargetStatus): boolean {
  return target !== 'accepted';
}

export function rejectionReason(
  ride: RideForRules,
  driverId: string,
  target: TargetStatus,
): 'other_driver' | 'invalid_transition' {
  const belongsToOtherDriver = ride.driverId !== null && ride.driverId !== driverId;
  return requiresAssignedDriver(target) && belongsToOtherDriver
    ? 'other_driver'
    : 'invalid_transition';
}

export function canRead(ride: RideForRules, user: User): boolean {
  if (user.role === 'passageiro') return ride.passengerId === user.id;
  return ride.status === 'requested' || ride.driverId === user.id;
}

// O motorista não precisa saber quem é o passageiro (minimização de dados da LGPD). Com
// undefined, o campo some do JSON da resposta; o cache e o evento continuam com ele.
export function visibleTo<T extends { passengerId: string }>(user: User, ride: T) {
  return user.role === 'motorista' ? { ...ride, passengerId: undefined } : ride;
}
