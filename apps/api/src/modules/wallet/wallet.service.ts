import { HttpStatus, Injectable } from '@nestjs/common';
import { count, desc, eq } from 'drizzle-orm';
import type { Paginated, Wallet, WalletTransaction, WalletTxType } from '@evtap/shared';
import { Database, InjectDb, Tx } from '../../db/db.module';
import { wallets, walletTransactions } from '../../db/schema';
import { AppError } from '../../common/errors';
import { pageArgs, paginated } from '../../common/pagination';
import { iso } from '../../common/util';
import { withTx } from './tx';

export interface WalletOpts { paymentId?: string | null; bookingId?: string | null; actorId?: string | null; tx?: Tx }
export interface CreditOpts extends WalletOpts {
  /** Part of `amount` that goes to the bonus balance (defaults to the whole amount for type BONUS, 0 otherwise). */
  bonusAmount?: number;
}
export interface DebitOpts extends WalletOpts {
  /** Ledger type of the debit row (default SPEND). */
  type?: WalletTxType;
  /**
   * BONUS_FIRST (default, purchases): bonus balance is spent before real money.
   * REAL_ONLY: only real balance (reversing a top-up, clawing back a payout).
   * BONUS_ONLY: only bonus balance (revoking a top-up bonus).
   */
  source?: 'BONUS_FIRST' | 'REAL_ONLY' | 'BONUS_ONLY';
}

type WalletRow = typeof wallets.$inferSelect;
type WalletTxRow = typeof walletTransactions.$inferSelect;

/** Splits a debit between bonus and real balance. Pure — exported for tests. */
export const splitDebit = (w: Pick<WalletRow, 'balance' | 'bonusBalance'>, amount: number, source: DebitOpts['source'] = 'BONUS_FIRST') => {
  const fromBonus = source === 'REAL_ONLY' ? 0 : Math.min(w.bonusBalance, amount);
  const fromReal = source === 'BONUS_ONLY' ? 0 : amount - fromBonus;
  const ok = fromBonus + fromReal === amount && fromReal <= w.balance;
  return { ok, fromBonus, fromReal };
};

const assertAmount = (amount: number) => {
  if (!Number.isInteger(amount) || amount <= 0) throw new AppError('INVALID_AMOUNT', 'Amount must be a positive integer (minor units)');
};

export const toWalletDto = (w: Pick<WalletRow, 'balance' | 'bonusBalance' | 'currency'>): Wallet => ({ balance: w.balance, bonusBalance: w.bonusBalance, currency: w.currency as Wallet['currency'] });
export const toWalletTxDto = (t: WalletTxRow): WalletTransaction => ({
  id: t.id, type: t.type as WalletTxType, amount: t.amount, balanceAfter: t.balanceAfter, description: t.description, paymentId: t.paymentId, createdAt: iso(t.createdAt)!,
});

/**
 * User wallet (AZN): real balance + non-refundable bonus balance. Every change is a row in `wallet_transactions`
 * written in the same transaction as the balance update, with the wallet row locked (`SELECT … FOR UPDATE`).
 */
@Injectable()
export class WalletService {
  constructor(@InjectDb() private readonly db: Database) {}

  private async lock(tx: Tx, userId: string): Promise<WalletRow> {
    await tx.insert(wallets).values({ userId }).onConflictDoNothing();
    const [w] = await tx.select().from(wallets).where(eq(wallets.userId, userId)).for('update');
    return w;
  }

  async get(userId: string): Promise<Wallet> {
    await this.db.insert(wallets).values({ userId }).onConflictDoNothing();
    const [w] = await this.db.select().from(wallets).where(eq(wallets.userId, userId));
    return toWalletDto(w);
  }

  async transactions(userId: string, page: number, pageSize: number): Promise<Paginated<WalletTransaction>> {
    const where = eq(walletTransactions.userId, userId);
    const rows = await this.db.select().from(walletTransactions).where(where).orderBy(desc(walletTransactions.createdAt), desc(walletTransactions.id)).limit(pageSize).offset(pageArgs(page, pageSize).offset);
    const [{ total }] = await this.db.select({ total: count() }).from(walletTransactions).where(where);
    return paginated(rows.map(toWalletTxDto), total, page, pageSize);
  }

  /** Adds money. Returns the ledger row. */
  async credit(userId: string, amount: number, type: WalletTxType, description: string, opts: CreditOpts = {}): Promise<WalletTxRow> {
    assertAmount(amount);
    const bonus = opts.bonusAmount ?? (type === 'BONUS' ? amount : 0);
    if (!Number.isInteger(bonus) || bonus < 0 || bonus > amount) throw new AppError('INVALID_AMOUNT', 'Invalid bonus amount');
    return withTx(this.db, opts.tx, async (tx) => {
      const w = await this.lock(tx, userId);
      const balance = w.balance + (amount - bonus);
      const bonusBalance = w.bonusBalance + bonus;
      await tx.update(wallets).set({ balance, bonusBalance }).where(eq(wallets.userId, userId));
      const [row] = await tx.insert(walletTransactions).values({
        userId, type, amount, bonusAmount: bonus, balanceAfter: balance + bonusBalance, description,
        paymentId: opts.paymentId ?? null, bookingId: opts.bookingId ?? null, actorId: opts.actorId ?? null,
      }).returning();
      return row;
    });
  }

  /** Takes money (bonus first by default). Throws 402 INSUFFICIENT_FUNDS. Ledger row has a negative amount. */
  async debit(userId: string, amount: number, description: string, opts: DebitOpts = {}): Promise<WalletTxRow> {
    assertAmount(amount);
    return withTx(this.db, opts.tx, async (tx) => {
      const w = await this.lock(tx, userId);
      const { ok, fromBonus, fromReal } = splitDebit(w, amount, opts.source);
      if (!ok) throw new AppError('INSUFFICIENT_FUNDS', 'Insufficient wallet balance', HttpStatus.PAYMENT_REQUIRED);
      const balance = w.balance - fromReal;
      const bonusBalance = w.bonusBalance - fromBonus;
      await tx.update(wallets).set({ balance, bonusBalance }).where(eq(wallets.userId, userId));
      const [row] = await tx.insert(walletTransactions).values({
        userId, type: opts.type ?? 'SPEND', amount: -amount, bonusAmount: -fromBonus, balanceAfter: balance + bonusBalance, description,
        paymentId: opts.paymentId ?? null, bookingId: opts.bookingId ?? null, actorId: opts.actorId ?? null,
      }).returning();
      return row;
    });
  }

  /** Removes up to `max` from the bonus balance (e.g. bonus of a refunded top-up). Returns the amount removed. */
  async revokeBonus(userId: string, max: number, description: string, opts: WalletOpts = {}): Promise<number> {
    if (max <= 0) return 0;
    return withTx(this.db, opts.tx, async (tx) => {
      const w = await this.lock(tx, userId);
      const amount = Math.min(max, w.bonusBalance);
      if (amount <= 0) return 0;
      await this.debit(userId, amount, description, { ...opts, tx, type: 'BONUS', source: 'BONUS_ONLY' });
      return amount;
    });
  }
}
