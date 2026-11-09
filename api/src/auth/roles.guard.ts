import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOWED_ROLES } from './decorators.js';
import type { AuthenticatedRequest, Role } from './user.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const allowed = this.reflector.getAllAndOverride<Role[] | undefined>(ALLOWED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowed) return true;

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (user && allowed.includes(user.role)) return true;
    throw new ForbiddenException('perfil sem permissão para esta operação');
  }
}
