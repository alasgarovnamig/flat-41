/** Wallet: balance, ledger, admin adjustments, card top-up bonus tiers, bonus-first spending. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { topupBonus } from '@evtap/shared';
import { payByCard } from '../src/bank';
import { bankOpts, CLIENT_RETURN_URL } from '../src/config';
import * as D from '../src/dto';
import { err, ok } from '../src/expect';
import { activeListing, admin, catalog, newUser, wallet } from '../src/fixtures';
import type { Api } from '../src/http';
import { anon } from '../src/http';

const bank = await bankOpts();

async function topUp(u: Api, amount: number) {
  const co = ok(await u.post('/checkout', { purpose: 'WALLET_TOPUP', amount, method: 'CARD', returnUrl: CLIENT_RETURN_URL }), D.CheckoutResponse);
  const r = await payByCard(co.paymentUrl!);
  assert.equal(r.status, 'SUCCEEDED');
  return co.paymentId;
}

describe('wallet', () => {
  test('GET /wallet starts at zero; admin adjustments are ledgered with balanceAfter (newest first)', async () => {
    const u = await newUser();
    assert.deepEqual(await wallet(u), { balance: 0, bonusBalance: 0, currency: 'AZN' });
    assert.deepEqual(ok(await u.get('/wallet/transactions'), D.Paginated(D.WalletTransaction)).items, []);
    const a = await admin();
    const w1 = ok(await a.post(`/admin/users/${u.id}/wallet-adjust`, { amount: 2500, reason: 'Kompensasiya' }), D.Wallet);
    assert.equal(w1.balance, 2500);
    const w2 = ok(await a.post(`/admin/users/${u.id}/wallet-adjust`, { amount: -1000, reason: 'Düzəliş' }), D.Wallet);
    assert.equal(w2.balance, 1500);
    err(await a.post(`/admin/users/${u.id}/wallet-adjust`, { amount: -5000, reason: 'Çox' }), 402, 'INSUFFICIENT_FUNDS');
    err(await a.post(`/admin/users/${u.id}/wallet-adjust`, { amount: 0, reason: 'Sıfır' }), 400, 'VALIDATION_ERROR');
    err(await a.post(`/admin/users/${u.id}/wallet-adjust`, { amount: 10, reason: '' }), 400, 'VALIDATION_ERROR');

    const txs = ok(await u.get('/wallet/transactions'), D.Paginated(D.WalletTransaction));
    assert.equal(txs.total, 2);
    assert.deepEqual(txs.items.map((t) => [t.type, t.amount, t.balanceAfter]), [['ADJUSTMENT', -1000, 1500], ['ADJUSTMENT', 2500, 2500]]);
    assert.equal(txs.items[0].description, 'Düzəliş');
    assert.equal(txs.items[0].paymentId, null);
    const page = ok(await u.get('/wallet/transactions', { query: { page: 2, pageSize: 1 } }), D.Paginated(D.WalletTransaction));
    assert.equal(page.items[0].amount, 2500);
    err(await anon().get('/wallet'), 401, 'UNAUTHORIZED');
    err(await anon().get('/wallet/transactions'), 401, 'UNAUTHORIZED');
  });

  test('card top-up bonus follows the topupBonuses tiers; below the first tier → no bonus', bank, async () => {
    const { settings } = await catalog();
    const u = await newUser();
    const small = Math.max(settings.minTopup, 1000);
    await topUp(u, small);
    assert.deepEqual(await wallet(u), { balance: small, bonusBalance: topupBonus(small, settings as any), currency: 'AZN' });
    const tier = [...settings.topupBonuses].sort((x, y) => y.minAmount - x.minAmount)[0];
    if (tier && tier.minAmount <= settings.maxTopup) {
      const v = await newUser();
      await topUp(v, tier.minAmount);
      const w = await wallet(v);
      assert.equal(w.balance, tier.minAmount);
      assert.equal(w.bonusBalance, Math.floor((tier.minAmount * tier.bonusPercent) / 100));
    }
  });

  test('wallet payments spend the bonus balance first', bank, async () => {
    const { settings } = await catalog();
    const firstTier = [...settings.topupBonuses].sort((x, y) => x.minAmount - y.minAmount)[0];
    assert.ok(firstTier, 'a top-up bonus tier is configured');
    const u = await newUser();
    const { listing } = await activeListing(u);
    await topUp(u, firstTier.minAmount);
    const before = await wallet(u);
    assert.ok(before.bonusBalance > 0);
    const bump = (await catalog()).services.find((s) => s.code === 'BUMP_1')!.price;
    ok(await u.post('/checkout', { purpose: 'PROMOTION', listingId: listing.id, serviceCodes: ['BUMP_1'], method: 'WALLET' }), D.CheckoutResponse);
    const after = await wallet(u);
    const fromBonus = Math.min(bump, before.bonusBalance);
    assert.equal(after.bonusBalance, before.bonusBalance - fromBonus);
    assert.equal(after.balance, before.balance - (bump - fromBonus));
  });
});
