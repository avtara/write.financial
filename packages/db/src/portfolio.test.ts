// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { withUser } from './db.ts';
import { createInvestments } from './investments.ts';
import { assetValuesIn, currentRateIn, holdingsValueByAccount } from './portfolio.ts';

let test: TestDatabase;
let alice: string;

const NOW = new Date('2026-10-15T09:42:00Z');
const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
const investments = () => createInvestments(test.db, { now: () => NOW });
const values = () => asApp(() => withUser(test.db, alice, (tx) => assetValuesIn(tx, alice, NOW)));

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

async function platform(currency: string): Promise<string> {
  const [row] = await test.query<{ id: string }>(
    `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_date, color)
     VALUES ($1, 'investment', $2, $3, $4, '2026-01-01', 'cyan') RETURNING id`,
    [alice, `P ${currency}`, `P ${currency}`, currency],
  );
  return row?.id as string;
}

beforeEach(async () => {
  await test.query('DELETE FROM users');
  alice = await insertUser(test, 'alice@example.test');
  await test.query(
    `INSERT INTO fx_rates (user_id, base, quote, rate, provider, rate_type, as_of)
     VALUES ($1, 'USD', 'IDR', 16350, 'manual', 'manual', '2026-10-15')`,
    [alice],
  );
});

describe('currentRateIn', () => {
  it('is 1 in the base currency, the reference rate otherwise, null when unknown', async () => {
    const rates = await asApp(() =>
      withUser(test.db, alice, async (tx) => [
        await currentRateIn(tx, 'IDR', 'IDR'),
        await currentRateIn(tx, 'USD', 'IDR'),
        await currentRateIn(tx, 'EUR', 'IDR'),
      ]),
    );
    expect(rates).toEqual(['1', '16350', null]);
  });
});

describe('assetValuesIn and holdingsValueByAccount', () => {
  it('values every asset now: priced, at cost without a price, unvalued without a rate; pending apart', async () => {
    const usd = await platform('USD');
    const idr = await platform('IDR');
    const eur = await platform('EUR');
    const repo = investments();
    const spy = await asApp(() =>
      repo.createAsset(alice, {
        accountId: usd,
        symbol: 'spy',
        name: 'SPDR S&P 500 ETF',
        assetClass: 'us_stocks',
        market: 'us_equity',
        manualPrice: '690.10',
        manualPriceAt: NOW,
      }),
    );
    const rdpu = await asApp(() =>
      repo.createAsset(alice, {
        accountId: idr,
        symbol: 'RDPU',
        name: 'RDPU',
        assetClass: 'cash',
        market: 'mutual_fund',
      }),
    );
    const vwce = await asApp(() =>
      repo.createAsset(alice, {
        accountId: eur,
        symbol: 'VWCE',
        name: 'VWCE',
        assetClass: 'international',
        market: 'us_equity',
        manualPrice: '130',
        manualPriceAt: NOW,
      }),
    );
    const buy = (assetId: string, units: string, amountMinor: bigint, pending = false) =>
      asApp(() =>
        repo.recordTrade(alice, {
          kind: 'buy',
          clientId: randomUUID(),
          assetId,
          occurredAt: new Date('2026-10-01T02:00:00Z'),
          units,
          amountMinor,
          fxRate: '1',
          pending,
        }),
      );
    await buy(spy.id, '1.19647849', 69_725n);
    await buy(rdpu.id, '1600', 3_000_000n, true);
    await buy(rdpu.id, '500', 925_000n);
    // No EUR rate: held from before (no cash leg needs one).
    await asApp(() =>
      repo.adjustHoldings(alice, {
        clientId: randomUUID(),
        assetId: vwce.id,
        occurredAt: new Date('2026-08-31T05:00:00Z'),
        units: '2',
        reason: 'unrecorded_buy',
        amountMinor: 26_000n,
        fxRate: '17500',
      }),
    );

    const result = await values();
    expect(result.baseCurrency).toBe('IDR');
    expect(result.missingRates).toEqual(['EUR']);
    const byId = new Map(result.assets.map((valuation) => [valuation.asset.id, valuation]));
    expect(byId.get(spy.id)).toMatchObject({
      fxRate: '16350',
      quote: { source: 'manual', price: '690.1' },
      holding: { units: '1.19647849', costMinor: 69_725n },
      value: { valueBaseMinor: 13_500_028n, priced: true },
    });
    // No price: at cost; the pending buy is apart (trade-date rate 1).
    expect(byId.get(rdpu.id)).toMatchObject({
      quote: null,
      pendingMinor: 3_000_000n,
      pendingBaseMinor: 3_000_000n,
      value: { valueBaseMinor: 925_000n, priced: false },
    });
    expect(byId.get(vwce.id)).toMatchObject({ fxRate: null, value: null });

    const byAccount = holdingsValueByAccount(result);
    expect(byAccount.get(usd)).toBe(13_500_028n);
    expect(byAccount.get(idr)).toBe(925_000n);
    expect(byAccount.get(eur)).toBeNull();
    // Once unvalued, an account stays unvalued.
    const twice = holdingsValueByAccount({ ...result, assets: [...result.assets, ...result.assets] });
    expect([twice.get(usd), twice.get(eur)]).toEqual([27_000_056n, null]);
  });

  it('is empty without assets', async () => {
    expect(await values()).toEqual({ baseCurrency: 'IDR', assets: [], missingRates: [] });
  });
});
