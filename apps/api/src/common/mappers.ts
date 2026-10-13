import type { User } from '@evtap/shared';
import type { users } from '../db/schema';
import { iso } from './util';

export type UserRow = typeof users.$inferSelect;

export const toUserDto = (u: UserRow): User => ({
  id: u.id,
  name: u.name,
  phone: u.phone,
  email: u.email,
  avatarUrl: u.avatarUrl,
  role: u.role as User['role'],
  accountType: u.accountType as User['accountType'],
  status: u.status as User['status'],
  locale: u.locale as User['locale'],
  isPhoneVerified: u.isPhoneVerified,
  isEmailVerified: u.isEmailVerified,
  agencyId: u.agencyId,
  createdAt: iso(u.createdAt)!,
});
