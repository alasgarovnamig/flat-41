import { mapRow, type Db, type Queryable } from '../db';
import type { CardTokenRow } from '../lib/types';
import { newId } from '../lib/util';

/** Saved cards. Only token, mask, brand, merchant and test flags are stored — never a PAN or CVV. */
export class TokenService {
  constructor(private readonly db: Db) {}

  async create(q: Queryable, data: { merchantId: string; mask: string; brand: string; customerId: string | null }): Promise<string> {
    const token = newId('tok', 16);
    await q.query('INSERT INTO card_tokens (token, merchant_id, mask, brand, customer_id) VALUES ($1, $2, $3, $4, $5)', [
      token,
      data.merchantId,
      data.mask,
      data.brand,
      data.customerId,
    ]);
    return token;
  }

  async find(q: Queryable, token: string, merchantId: string, opts: { forUpdate?: boolean } = {}): Promise<CardTokenRow | null> {
    const { rows } = await q.query(
      `SELECT * FROM card_tokens WHERE token = $1 AND merchant_id = $2${opts.forUpdate ? ' FOR UPDATE' : ''}`,
      [token, merchantId],
    );
    return rows[0] ? mapRow<CardTokenRow>(rows[0]) : null;
  }

  async touch(q: Queryable, token: string): Promise<void> {
    await q.query('UPDATE card_tokens SET last_used_at = now() WHERE token = $1', [token]);
  }

  /** Returns true when a token was deleted. */
  async delete(token: string, merchantId?: string): Promise<boolean> {
    const { rowCount } = merchantId
      ? await this.db.query('DELETE FROM card_tokens WHERE token = $1 AND merchant_id = $2', [token, merchantId])
      : await this.db.query('DELETE FROM card_tokens WHERE token = $1', [token]);
    return (rowCount ?? 0) > 0;
  }

  async setInsufficientFunds(token: string, value: boolean): Promise<boolean> {
    const { rowCount } = await this.db.query('UPDATE card_tokens SET force_insufficient_funds = $2 WHERE token = $1', [token, value]);
    return (rowCount ?? 0) > 0;
  }

  async list(filter: { merchantId?: string; q?: string } = {}): Promise<CardTokenRow[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.merchantId) {
      params.push(filter.merchantId);
      where.push(`merchant_id = $${params.length}`);
    }
    if (filter.q) {
      params.push(`%${filter.q}%`);
      where.push(`(token ILIKE $${params.length} OR mask ILIKE $${params.length} OR customer_id ILIKE $${params.length})`);
    }
    const { rows } = await this.db.query(
      `SELECT * FROM card_tokens ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 500`,
      params,
    );
    return rows.map((r) => mapRow<CardTokenRow>(r));
  }
}
