import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { AuthenticatedRequest } from './user.js';

@Injectable()
export class UserRateLimitGuard extends ThrottlerGuard {
  // Conta por usuário do token e não por IP: atrás do proxy da UI todos chegariam com o mesmo IP.
  protected override async getTracker(request: AuthenticatedRequest): Promise<string> {
    return request.user?.id ?? request.ip ?? 'unknown';
  }
}
