import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { UserRole } from '@evtap/shared';

export interface AuthUser { id: string; role: UserRole; accountType: string; agencyId: string | null }

export const IS_PUBLIC = 'isPublic';
/** Route needs no authentication. If a valid token is present, req.user is still populated. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
/** Restrict to roles. `@Roles('ADMIN','MODERATOR')` */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles);

/** `@CurrentUser() user: AuthUser` (undefined on public routes without token) */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser | undefined => ctx.switchToHttp().getRequest().user);

/** Client IP (respects X-Forwarded-For behind a proxy). */
export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext): string | null => {
  const req = ctx.switchToHttp().getRequest();
  return (req.headers['x-forwarded-for']?.split(',')[0]?.trim() as string) || req.ip || null;
});
