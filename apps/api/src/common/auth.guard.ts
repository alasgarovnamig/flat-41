import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { config } from '../config';
import { forbidden } from './errors';
import { AuthUser, IS_PUBLIC, ROLES } from './decorators';
import type { UserRole } from '@evtap/shared';

/**
 * Global guard: every route requires a valid access token unless decorated with @Public().
 * Also enforces @Roles(). ADMIN implicitly passes MODERATOR checks.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (token) {
      try {
        const p = this.jwt.verify(token, { secret: config.jwt.accessSecret });
        req.user = { id: p.sub, role: p.role, accountType: p.acc, agencyId: p.ag ?? null } satisfies AuthUser;
      } catch {
        if (!isPublic) throw new UnauthorizedException({ statusCode: 401, code: 'TOKEN_INVALID', message: 'Invalid or expired token' });
      }
    }
    if (isPublic) return true;
    if (!req.user) throw new UnauthorizedException({ statusCode: 401, code: 'UNAUTHORIZED', message: 'Authentication required' });

    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length) {
      const role = req.user.role as UserRole;
      const ok = roles.includes(role) || (role === 'ADMIN' && roles.includes('MODERATOR'));
      if (!ok) throw forbidden('Insufficient role');
    }
    return true;
  }
}
