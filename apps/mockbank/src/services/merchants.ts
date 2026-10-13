import type { MerchantSeed } from '../config';
import { mapRow, type Db } from '../db';
import type { Merchant } from '../lib/types';

export interface MerchantStats extends Merchant {
  orderCount: number;
  approvedCount: number;
  tokenCount: number;
}

export class MerchantService {
  private cache = new Map<string, Merchant>();

  constructor(private readonly db: Db) {}

  /** Upserts merchants from the MERCHANTS env (secret / name changes are applied on boot). */
  async seed(seeds: MerchantSeed[]): Promise<void> {
    for (const m of seeds) {
      await this.db.query(
        `INSERT INTO merchants (id, name, secret) VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, secret = EXCLUDED.secret`,
        [m.id, m.name, m.secret],
      );
    }
    this.cache.clear();
  }

  async get(id: string): Promise<Merchant | null> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const { rows } = await this.db.query('SELECT * FROM merchants WHERE id = $1', [id]);
    if (!rows[0]) return null;
    const merchant = mapRow<Merchant>(rows[0]);
    this.cache.set(id, merchant);
    return merchant;
  }

  async list(): Promise<MerchantStats[]> {
    const { rows } = await this.db.query(`
      SELECT m.*,
        (SELECT count(*) FROM orders o WHERE o.merchant_id = m.id)::int AS order_count,
        (SELECT count(*) FROM orders o WHERE o.merchant_id = m.id AND o.status IN ('APPROVED','REFUNDED','PARTIALLY_REFUNDED'))::int AS approved_count,
        (SELECT count(*) FROM card_tokens t WHERE t.merchant_id = m.id)::int AS token_count
      FROM merchants m ORDER BY m.created_at, m.id`);
    return rows.map((r) => mapRow<MerchantStats>(r));
  }
}
