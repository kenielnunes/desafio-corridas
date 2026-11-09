import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { importSPKI, jwtVerify } from 'jose';
import { config } from '../config.js';
import { IS_PUBLIC } from './decorators.js';
import { type AuthenticatedRequest, ClaimsSchema } from './user.js';

const ALLOWED_ALGORITHMS = ['RS256'];

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly publicKey = importSPKI(config.jwt.publicKeyPem, 'RS256');

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const [type, token] = request.headers.authorization?.split(' ') ?? [];

    try {
      if (type !== 'Bearer' || !token) throw new Error('token ausente');
      const { payload } = await jwtVerify(token, await this.publicKey, {
        algorithms: ALLOWED_ALGORITHMS,
        issuer: config.jwt.issuer,
        audience: config.jwt.audience,
        requiredClaims: ['exp'],
      });
      const claims = ClaimsSchema.parse(payload);
      request.user = { id: claims.sub, role: claims.role };
      return true;
    } catch {
      http.getResponse<Response>().setHeader('WWW-Authenticate', 'Bearer');
      throw new UnauthorizedException('token ausente ou inválido');
    }
  }
}
