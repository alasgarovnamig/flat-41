import type { Agency, AgencySummary } from '@evtap/shared';
import { agencies } from '../../db/schema';
import { iso } from '../../common/util';

export type AgencyRow = typeof agencies.$inferSelect;

export const toAgencySummary = (a: AgencyRow): AgencySummary => ({
  id: a.id,
  name: a.name,
  slug: a.slug,
  logoUrl: a.logoUrl,
  type: a.type as AgencySummary['type'],
  verified: a.verified,
});

export const toAgency = (a: AgencyRow, activeListings: number): Agency => ({
  ...toAgencySummary(a),
  description: a.description,
  phone: a.phone,
  email: a.email,
  website: a.website,
  address: a.address,
  cityId: a.cityId,
  ownerId: a.ownerId,
  activeListings,
  createdAt: iso(a.createdAt)!,
});
