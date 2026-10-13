import { HttpStatus, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { checkoutSchema, formatMoney, planPrice, topupBonus, type CheckoutResponse, type ListingStatus } from '@evtap/shared';
import type { z } from 'zod';
import { Database, InjectDb } from '../../db/db.module';
import { listings, users } from '../../db/schema';
import { AppError, forbidden, notFound } from '../../common/errors';
import { SettingsService } from '../settings/settings.service';
import { PaymentsService, StartPaymentInput } from './payments.service';

export type CheckoutParsed = z.output<typeof checkoutSchema>;
type Item = { code: string; name: string; amount: number };

const PERIOD_AZ = { MONTH: 'aylıq', YEAR: 'illik' } as const;

/** POST /checkout — turns a CheckoutInput into a priced payment (prices always come from the DB catalog). */
@Injectable()
export class CheckoutService {
  constructor(@InjectDb() private readonly db: Database, private readonly settings: SettingsService, private readonly payments: PaymentsService) {}

  private async ownedListing(userId: string, listingId: string, statuses: ListingStatus[]) {
    const [l] = await this.db.select().from(listings).where(eq(listings.id, listingId));
    if (!l) throw notFound('Listing');
    if (l.ownerId !== userId) throw forbidden('Not your listing');
    if (!statuses.includes(l.status as ListingStatus)) {
      throw new AppError('LISTING_STATUS_INVALID', `Listing must be ${statuses.join(' or ')} (is ${l.status})`, HttpStatus.CONFLICT);
    }
    return l;
  }

  async checkout(userId: string, input: CheckoutParsed): Promise<CheckoutResponse> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user || user.status !== 'ACTIVE') throw forbidden('Account is not active');
    const s = await this.settings.getSettings();
    const common = {
      userId, method: input.method, returnUrl: input.returnUrl, language: user.locale as 'az' | 'ru' | 'en',
      customer: { phone: user.phone, email: user.email },
    } satisfies Partial<StartPaymentInput>;

    switch (input.purpose) {
      case 'WALLET_TOPUP': {
        if (input.amount < s.minTopup || input.amount > s.maxTopup) {
          throw new AppError('AMOUNT_OUT_OF_RANGE', `Top-up must be between ${formatMoney(s.minTopup)} and ${formatMoney(s.maxTopup)}`);
        }
        const bonus = topupBonus(input.amount, s);
        return (await this.payments.startPayment({
          ...common, purpose: 'WALLET_TOPUP', amount: input.amount, description: `Balansın artırılması — ${formatMoney(input.amount)}`,
          items: [{ code: 'TOPUP', name: 'Balansın artırılması', amount: input.amount }], metadata: { bonus },
        })).checkout;
      }

      case 'PROMOTION': {
        if (!input.serviceCodes?.length && !input.bundleCode) throw new AppError('VALIDATION_ERROR', 'serviceCodes or bundleCode is required');
        const l = await this.ownedListing(userId, input.listingId, ['ACTIVE', 'PENDING']);
        const catalog = await this.settings.getCatalog();
        const items: Item[] = [];
        const serviceCodes: string[] = [];
        for (const code of input.serviceCodes ?? []) {
          const svc = catalog.services.find((x) => x.code === code);
          if (!svc || !svc.promotionType) throw new AppError('INVALID_SERVICE', `Unknown or unavailable service ${code}`);
          items.push({ code, name: svc.name.az, amount: svc.price });
          serviceCodes.push(code);
        }
        if (input.bundleCode) {
          const bundle = catalog.bundles.find((b) => b.code === input.bundleCode);
          if (!bundle) throw new AppError('INVALID_SERVICE', `Unknown bundle ${input.bundleCode}`);
          items.push({ code: bundle.code, name: bundle.name.az, amount: bundle.price });
          serviceCodes.push(...bundle.serviceCodes);
        }
        if (serviceCodes.length > 20) throw new AppError('VALIDATION_ERROR', 'Too many services in one order');
        const amount = items.reduce((a, i) => a + i.amount, 0);
        return (await this.payments.startPayment({
          ...common, purpose: 'PROMOTION', amount, listingId: l.id, items, metadata: { serviceCodes },
          description: `${items.map((i) => i.name).join(', ')} — "${l.title}"`,
        })).checkout;
      }

      case 'LISTING_FEE': {
        const l = await this.ownedListing(userId, input.listingId, ['DRAFT']);
        return (await this.payments.startPayment({
          ...common, purpose: 'LISTING_FEE', amount: s.listingFee, listingId: l.id, description: `Elan yerləşdirmə haqqı — "${l.title}"`,
          items: [{ code: 'LISTING_FEE', name: 'Elan yerləşdirmə haqqı', amount: s.listingFee }],
        })).checkout;
      }

      case 'VERIFICATION': {
        const l = await this.ownedListing(userId, input.listingId, ['ACTIVE', 'PENDING']);
        if (l.isVerified) throw new AppError('ALREADY_VERIFIED', 'Listing is already verified', HttpStatus.CONFLICT);
        const svc = await this.settings.getService('VERIFICATION');
        if (!svc?.active) throw new AppError('INVALID_SERVICE', 'Verification is not available');
        return (await this.payments.startPayment({
          ...common, purpose: 'VERIFICATION', amount: svc.price, listingId: l.id, description: `${svc.name.az} — "${l.title}"`,
          items: [{ code: svc.code, name: svc.name.az, amount: svc.price }],
        })).checkout;
      }

      case 'SUBSCRIPTION': {
        const plan = await this.settings.getPlan(input.planCode);
        if (!plan?.active) throw new AppError('INVALID_PLAN', 'Plan is not available');
        const amount = planPrice(plan, input.period);
        const name = `${plan.name.az} abunəliyi (${PERIOD_AZ[input.period]})`;
        return (await this.payments.startPayment({
          ...common, purpose: 'SUBSCRIPTION', amount, description: name, items: [{ code: `${plan.code}_${input.period}`, name, amount }],
          metadata: { planCode: plan.code, period: input.period, autoRenew: input.autoRenew },
          saveCard: input.method === 'CARD', // the bank token is stored on the subscription for auto-renewal
        })).checkout;
      }
    }
  }
}
