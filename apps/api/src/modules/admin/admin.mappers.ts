import { sql } from 'drizzle-orm';
import type { AuditLog, ListingReport, Payment, WalletTransaction } from '@evtap/shared';
import { auditLogs, listingReports, payments, walletTransactions } from '../../db/schema';
import { iso } from '../../common/util';

export const reportColumns = {
  r: listingReports,
  listingTitle: sql<string>`(select l.title from listings l where l.id = "listing_reports"."listing_id")`,
  reporterName: sql<string | null>`(select u.name from users u where u.id = "listing_reports"."reporter_id")`,
};

export const toReportDto = ({ r, listingTitle, reporterName }: { r: typeof listingReports.$inferSelect; listingTitle: string; reporterName: string | null }): ListingReport => ({
  id: r.id,
  listingId: r.listingId,
  listingTitle: listingTitle ?? '',
  reporter: r.reporterId ? { id: r.reporterId, name: reporterName ?? '' } : null,
  reason: r.reason as ListingReport['reason'],
  comment: r.comment,
  status: r.status as ListingReport['status'],
  createdAt: iso(r.createdAt)!,
  resolvedAt: iso(r.resolvedAt),
});

export const toPaymentDto = (p: typeof payments.$inferSelect): Payment => ({
  id: p.id, userId: p.userId, purpose: p.purpose as Payment['purpose'], method: p.method as Payment['method'], amount: p.amount,
  currency: p.currency as Payment['currency'], status: p.status as Payment['status'], description: p.description, listingId: p.listingId,
  bookingId: p.bookingId, items: p.items, provider: p.provider, providerOrderId: p.providerOrderId, cardMask: p.cardMask,
  refundedAmount: p.refundedAmount, failureReason: p.failureReason, createdAt: iso(p.createdAt)!, paidAt: iso(p.paidAt),
});

export const toWalletTxDto = (t: typeof walletTransactions.$inferSelect): WalletTransaction => ({
  id: t.id, type: t.type as WalletTransaction['type'], amount: t.amount, balanceAfter: t.balanceAfter, description: t.description,
  paymentId: t.paymentId, createdAt: iso(t.createdAt)!,
});

export const toAuditDto = (a: typeof auditLogs.$inferSelect, actorName: string | null): AuditLog => ({
  id: a.id, actor: a.actorId ? { id: a.actorId, name: actorName ?? '' } : null, action: a.action, entity: a.entity, entityId: a.entityId,
  data: a.data, ip: a.ip, createdAt: iso(a.createdAt)!,
});
