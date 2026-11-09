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

export function isTransitionAllowed(current: RideStatus, target: TargetStatus): boolean {
  return PREVIOUS_STATUS[target] === current;
}

export function requiresAssignedDriver(target: TargetStatus): boolean {
  return target !== 'accepted';
}

export function canRead(ride: RideForRules, user: User): boolean {
  if (user.role === 'passageiro') return ride.passengerId === user.id;
  return ride.status === 'requested' || ride.driverId === user.id;
}
