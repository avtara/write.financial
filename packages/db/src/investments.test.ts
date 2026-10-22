// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import type { LocalDate } from '@wf/domain/period';
import type * as DomainInvestments from '@wf/domain/investments';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureGetDek } from '../test/ledger-fixture.ts';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createAccounts } from './accounts.ts';
import { createInvestments, type AssetInput, type TradeRecord } from './investments.ts';
import { createTransactions } from './transactions.ts';

// An unexpected failure of the holding math (not an invalid trade) must surface as is: fee 4242 triggers one.
vi.mock('@wf/domain/investments', async (importOriginal) => {
  const actual = await importOriginal<typeof DomainInvestments>();
  return {
    ...actual,
    tradeEffect: (...args: Parameters<typeof actual.tradeEffect>) => {
      if (args[1].feeMinor === 4_242n) throw new TypeError('holding math failed');
      return actual.tradeEffect(...args);
    },
  };
});

let test: TestDatabase;
let userId: string;
let bca: string;
let wise: string;
let gotrade: string;
let bibit: string;
let goalA: string;
let goalB: string;

const NOW = new Date('2026-10-15T09:42:00Z');
const repo = () => createInvestments(test.db, { now: () => NOW });
const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
const at = (date: string, time = '12:00') => new Date(`${date}T${time}:00+07:00`);

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

async function account(type: string, name: string, currency: string, opening: bigint, status = 'active') {
  const [row] = await test.query<{ id: string }>(
    `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_balance_minor, opening_date,
                           color, include_in_available, status, archived_at)
     VALUES ($1, $2, $3, $4, $5, $6, '2026-01-01', 'blue', $7, $8, $9) RETURNING id`,
    [userId, type, name, name, currency, opening, type !== 'investment', status, status === 'archived' ? NOW : null],
  );
  return row?.id as string;
}

async function goal(name: string): Promise<string> {
  const [row] = await test.query<{ id: string }>(
    `INSERT INTO goals (user_id, name, icon, color, target_minor, currency) VALUES ($1, $2, 'target', 'blue', 1000, 'IDR')
     RETURNING id`,
    [userId, name],
  );
  return row?.id as string;
}

beforeEach(async () => {
  await test.query('DELETE FROM users');
  userId = await insertUser(test, 'avtara@example.test');
  await test.query(`UPDATE users SET base_currency = 'IDR', timezone = 'Asia/Jakarta' WHERE id = $1`, [userId]);
  await test.query(
    `INSERT INTO fx_rates (user_id, base, quote, rate, provider, rate_type, as_of)
     VALUES ($1, 'USD', 'IDR', 16350, 'manual', 'manual', '2026-10-15')`,
    [userId],
  );
  bca = await account('bank', 'BCA', 'IDR', 50_000_000n);
  wise = await account('bank', 'Wise', 'USD', 0n);
  gotrade = await account('investment', 'Gotrade', 'USD', 100_000n);
  bibit = await account('investment', 'Bibit', 'IDR', 5_000_000n);
  goalA = await goal('DP Rumah');
  goalB = await goal('Dana Pensiun');
});

const spyInput = (overrides: Partial<AssetInput> = {}): AssetInput => ({
  accountId: gotrade,
  symbol: ' spy ',
  name: ' SPDR S&P 500 ETF ',
  assetClass: 'us_stocks',
  market: 'us_equity',
  manualPrice: '690.10',
  manualPriceAt: NOW,
  ...overrides,
});
const createSpy = (overrides: Partial<AssetInput> = {}) => asApp(() => repo().createAsset(userId, spyInput(overrides)));
const trade = (input: TradeRecord) => asApp(() => repo().recordTrade(userId, input));
const buy = (assetId: string, units: string, amountMinor: bigint, extra: Partial<TradeRecord> = {}) =>
  trade({
    kind: 'buy',
    clientId: randomUUID(),
    assetId,
    occurredAt: at('2026-10-01'),
    units,
    amountMinor,
    ...extra,
  } as TradeRecord);
const balance = async (id: string) =>
  (await asApp(() => createAccounts(test.db, { now: () => NOW }).get(userId, id))).balanceMinor;
const sources = (assetId: string) =>
  test.query<{ goal_id: string; mode: string; pct_bps: number | null }>(
    'SELECT goal_id, mode, pct_bps FROM goal_funding_sources WHERE asset_id = $1 ORDER BY sort_order',
    [assetId],
  );
const allocate = async (assetId: string, rows: [string, string, number | null][]) => {
  for (const [index, [goalId, mode, pct]] of rows.entries()) {
    await test.query(
      `INSERT INTO goal_funding_sources (user_id, goal_id, asset_id, mode, pct_bps, sort_order) VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, goalId, assetId, mode, pct, index],
    );
  }
};

describe('assets (FR-I1)', () => {
  it('creates an asset in its platform’s currency, normalized, priced manually', async () => {
    const spy = await createSpy();
    expect(spy).toMatchObject({
      symbol: 'SPY',
      name: 'SPDR S&P 500 ETF',
      quoteCurrency: 'USD',
      platformName: 'Gotrade',
      priceMode: 'manual',
      manualPrice: '690.1',
      categoryId: null,
      averagePrice: null,
      goals: [],
      freeBps: 10_000,
      quote: { source: 'manual', price: '690.1' },
    });
    const btc = await asApp(() =>
      repo().createAsset(userId, {
        accountId: bibit,
        symbol: 'BTC',
        name: 'Bitcoin',
        assetClass: 'crypto',
        market: 'crypto',
      }),
    );
    expect(btc).toMatchObject({ priceMode: 'server', manualPrice: null, quote: null, quoteCurrency: 'IDR' });
  });

  it('refuses invalid input, foreign or archived platforms, and a duplicate symbol', async () => {
    await createSpy();
    const archived = await account('investment', 'Old', 'IDR', 0n, 'archived');
    const cases: [Partial<AssetInput>, string][] = [
      [{}, 'INVALID_ASSET'],
      [{ symbol: '  ' }, 'INVALID_ASSET'],
      [{ symbol: 'X'.repeat(21) }, 'INVALID_ASSET'],
      [{ symbol: 'QQQ', name: '' }, 'INVALID_ASSET'],
      [{ symbol: 'QQQ', assetClass: 'bonds' as 'cash' }, 'INVALID_ASSET'],
      [{ symbol: 'QQQ', market: 'moon' as 'fx' }, 'INVALID_ASSET'],
      [{ symbol: 'QQQ', manualPrice: 'abc' }, 'INVALID_ASSET'],
      [{ symbol: 'QQQ', manualPrice: '0' }, 'INVALID_ASSET'],
      [{ symbol: 'QQQ', manualPriceAt: null }, 'INVALID_ASSET'],
      [{ symbol: 'QQQ', manualPrice: null, manualPriceAt: null, priceMode: 'manual' }, 'INVALID_ASSET'],
      [{ symbol: 'QQQ', priceMode: 'live' as 'manual' }, 'INVALID_ASSET'],
      [{ symbol: 'QQQ', premiumBps: -10_000 }, 'INVALID_ASSET'],
      [{ symbol: 'QQQ', premiumBps: 1.5 }, 'INVALID_ASSET'],
      [{ symbol: 'QQQ', categoryId: randomUUID() }, 'NOT_FOUND'],
      [{ symbol: 'QQQ', accountId: bca }, 'INVALID_ASSET'],
      [{ symbol: 'QQQ', accountId: archived }, 'ACCOUNT_ARCHIVED'],
      [{ symbol: 'QQQ', accountId: randomUUID() }, 'NOT_FOUND'],
    ];
    for (const [overrides, code] of cases) {
      await expect(createSpy(overrides)).rejects.toMatchObject({ code });
    }
  });

  it('puts an asset in a category and values a whole-asset goal source', async () => {
    const category = await asApp(() => repo().createCategory(userId, { name: 'Inti', assetClass: 'us_stocks' }));
    const spy = await createSpy({ categoryId: category.id });
    await buy(spy.id, '1', 60_000n);
    await allocate(spy.id, [[goalA, 'whole', null]]);
    const view = await asApp(() => repo().asset(userId, spy.id));
    expect(view.categoryId).toBe(category.id);
    expect(view.goals).toEqual([
      expect.objectContaining({ goalId: goalA, mode: 'whole', bps: 10_000, units: '1', valueBaseMinor: 11_283_135n }),
    ]);
    expect(view.freeBps).toBe(0);
    // A whole source stays whole after a sale.
    await trade({
      kind: 'sell',
      clientId: randomUUID(),
      assetId: spy.id,
      occurredAt: at('2026-10-15'),
      units: '0.5',
      amountMinor: 34_000n,
    });
    expect(await sources(spy.id)).toEqual([{ goal_id: goalA, mode: 'whole', pct_bps: null }]);
  });

  it('updates details, keeping the platform, and refuses a symbol the platform already has', async () => {
    const spy = await createSpy();
    const qqq = await createSpy({ symbol: 'QQQ', name: 'Invesco QQQ' });
    const updated = await asApp(() =>
      repo().updateAsset(userId, qqq.id, {
        name: 'Invesco QQQ Trust',
        premiumBps: 650,
        priceMode: 'byok',
        meta: { symbols: { tiingo: 'qqq' } },
      }),
    );
    expect(updated).toMatchObject({ name: 'Invesco QQQ Trust', symbol: 'QQQ', premiumBps: 650, priceMode: 'byok' });
    expect(
      (await asApp(() => repo().updateAsset(userId, qqq.id, { manualPrice: null, manualPriceAt: null }))).manualPrice,
    ).toBeNull();
    await expect(asApp(() => repo().updateAsset(userId, qqq.id, { symbol: 'spy' }))).rejects.toMatchObject({
      code: 'INVALID_ASSET',
    });
    await expect(asApp(() => repo().updateAsset(userId, randomUUID(), {}))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(asApp(() => repo().asset(userId, randomUUID()))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await asApp(() => repo().asset(userId, spy.id))).symbol).toBe('SPY');
  });

  it('removes an asset with its trades and goal sources, keeping the cash transactions', async () => {
    const spy = await createSpy();
    const bought = await buy(spy.id, '0.1', 6_900n);
    await allocate(spy.id, [[goalA, 'whole', null]]);
    await asApp(() => repo().removeAsset(userId, spy.id));
    expect(await test.query('SELECT count(*)::int AS n FROM investment_trades')).toEqual([{ n: 0 }]);
    expect(await test.query('SELECT count(*)::int AS n FROM goal_funding_sources')).toEqual([{ n: 0 }]);
    expect(await test.query('SELECT deleted_at FROM transactions WHERE id = $1', [bought.transactionId])).toEqual([
      { deleted_at: null },
    ]);
    await expect(asApp(() => repo().removeAsset(userId, spy.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('categories ("Daftar saya") and targets', () => {
  it('creates, edits with members (one category per asset), moves, and removes categories', async () => {
    const spy = await createSpy();
    const qqq = await createSpy({ symbol: 'QQQ' });
    const income = await asApp(() => repo().createCategory(userId, { name: ' YieldMax ', assetClass: 'income' }));
    const us = await asApp(() => repo().createCategory(userId, { name: 'US individual', assetClass: 'us_stocks' }));
    expect([income.name, income.sortOrder, us.sortOrder]).toEqual(['YieldMax', 0, 1]);
    await asApp(() => repo().moveAsset(userId, spy.id, income.id));
    const moved = await asApp(() =>
      repo().updateCategory(userId, us.id, { name: 'US', assetClass: 'us_stocks', assetIds: [spy.id, qqq.id] }),
    );
    expect(moved).toMatchObject({ name: 'US', assetIds: [spy.id, qqq.id] });
    expect((await asApp(() => repo().updateCategory(userId, income.id, {}))).assetIds).toEqual([]);
    expect((await asApp(() => repo().updateCategory(userId, us.id, { assetIds: [] }))).assetIds).toEqual([]);
    await asApp(() => repo().moveAsset(userId, qqq.id, us.id));
    await asApp(() => repo().removeCategory(userId, us.id));
    expect((await asApp(() => repo().asset(userId, qqq.id))).categoryId).toBeNull();
    await asApp(() => repo().moveAsset(userId, qqq.id, null));
    const portfolio = await asApp(() => repo().portfolio(userId));
    expect(portfolio.categories.map((category) => category.name)).toEqual(['YieldMax']);
  });

  it('refuses invalid names and classes, unknown categories and assets', async () => {
    const spy = await createSpy();
    const category = await asApp(() => repo().createCategory(userId, { name: 'Inti', assetClass: 'us_stocks' }));
    await expect(asApp(() => repo().createCategory(userId, { name: ' ', assetClass: 'cash' }))).rejects.toMatchObject({
      code: 'INVALID_ASSET',
    });
    await expect(
      asApp(() => repo().createCategory(userId, { name: 'x', assetClass: 'bonds' as 'cash' })),
    ).rejects.toMatchObject({ code: 'INVALID_ASSET' });
    await expect(
      asApp(() => repo().updateCategory(userId, category.id, { name: 'y'.repeat(41) })),
    ).rejects.toMatchObject({ code: 'INVALID_ASSET' });
    await expect(
      asApp(() => repo().updateCategory(userId, category.id, { assetClass: 'bonds' as 'cash' })),
    ).rejects.toMatchObject({ code: 'INVALID_ASSET' });
    await expect(
      asApp(() => repo().updateCategory(userId, category.id, { assetIds: [randomUUID()] })),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(asApp(() => repo().updateCategory(userId, randomUUID(), {}))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(asApp(() => repo().removeCategory(userId, randomUUID()))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(asApp(() => repo().moveAsset(userId, spy.id, randomUUID()))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('replaces targets that total exactly 100%, refusing anything else', async () => {
    await asApp(() => repo().setTargets(userId, { us_stocks: 6000, cash: 4000 }));
    await asApp(() => repo().setTargets(userId, { us_stocks: 10_000 }));
    expect(await test.query('SELECT asset_class, target_bps FROM allocation_targets')).toEqual([
      { asset_class: 'us_stocks', target_bps: 10_000 },
    ]);
    for (const targets of [{ us_stocks: 9000 }, { us_stocks: 10_000.5 }, { bonds: 10_000 }]) {
      await expect(asApp(() => repo().setTargets(userId, targets as never))).rejects.toMatchObject({
        code: 'INVALID_ASSET',
      });
    }
  });
});

describe('recordTrade (FR-I2)', () => {
  it('buy: units at average cost, cash leg on the platform with fee and tax, idempotent', async () => {
    const spy = await createSpy();
    const clientId = randomUUID();
    const input: TradeRecord = {
      kind: 'buy',
      clientId,
      assetId: spy.id,
      occurredAt: at('2026-10-15', '19:50'),
      units: '0.0725',
      price: '690.10',
      amountMinor: 5_000n,
      feeMinor: 15n,
      taxMinor: 2n,
      description: 'DCA',
    };
    const first = await trade(input);
    expect(first).toMatchObject({
      kind: 'buy',
      status: 'settled',
      units: '0.0725',
      price: '690.1',
      fxRate: '16350',
      localDate: '2026-10-15',
    });
    expect(await trade(input)).toEqual(first);
    expect(await balance(gotrade)).toBe(100_000n - 5_017n);
    expect(
      await test.query(
        `SELECT p.role, p.amount_minor::text AS amount, c.name FROM postings p LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.transaction_id = $1 ORDER BY p.amount_minor`,
        [first.transactionId],
      ),
    ).toEqual([
      { role: 'principal', amount: '-5000', name: null },
      { role: 'fee', amount: '-15', name: 'system:platform_fee' },
      { role: 'fee', amount: '-2', name: 'system:tax_stamp' },
    ]);
    // Managed: the Transactions page cannot edit or delete it.
    await expect(
      asApp(() =>
        createTransactions(test.db, { getDek: fixtureGetDek }).remove(userId, [first.transactionId as string]),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_TRANSACTION' });
    const asset = await asApp(() => repo().asset(userId, spy.id));
    expect(asset.holding).toMatchObject({ units: '0.0725', costMinor: 5_000n, costBaseMinor: 817_500n });
    expect(asset.averagePrice).toBe('689.655172413793103448');
    await expect(buy(spy.id, '1', 10_000n, { feeMinor: 4_242n })).rejects.toThrow('holding math failed');
  });

  it('pending buy: paid now, units when settled; refuses settling twice', async () => {
    const rdpu = await asApp(() =>
      repo().createAsset(userId, {
        accountId: bibit,
        symbol: 'RDPU',
        name: 'RDPU',
        assetClass: 'cash',
        market: 'mutual_fund',
      }),
    );
    const pending = await buy(rdpu.id, '1621.62', 3_000_000n, { pending: true, price: '1850' });
    expect(await balance(bibit)).toBe(2_000_000n);
    const before = await asApp(() => repo().asset(userId, rdpu.id));
    expect([before.holding.units, before.pendingMinor, before.pendingBaseMinor]).toEqual(['0', 3_000_000n, 3_000_000n]);
    const settled = await asApp(() => repo().settleTrade(userId, pending.id, { units: '1621.621622' }));
    expect(settled).toMatchObject({ status: 'settled', units: '1621.621622', price: '1850' });
    await expect(asApp(() => repo().settleTrade(userId, pending.id, { units: '1', price: '2' }))).rejects.toMatchObject(
      { code: 'INVALID_TRADE' },
    );
    await expect(asApp(() => repo().settleTrade(userId, randomUUID(), { units: '1' }))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const again = await buy(rdpu.id, '1', 1_850n, { pending: true });
    expect((await asApp(() => repo().settleTrade(userId, again.id, { units: '1', price: '1850' }))).price).toBe('1850');
  });

  it('sell: realized gain, proceeds to cash or withdrawn to a bank in the same currency', async () => {
    const btc = await asApp(() =>
      repo().createAsset(userId, {
        accountId: bibit,
        symbol: 'BTC',
        name: 'Bitcoin',
        assetClass: 'crypto',
        market: 'crypto',
        manualPrice: '1460000000',
        manualPriceAt: NOW,
      }),
    );
    await buy(btc.id, '0.003767123288', 3_890_000n);
    const sold = await trade({
      kind: 'sell',
      clientId: randomUUID(),
      assetId: btc.id,
      occurredAt: at('2026-10-15'),
      units: '0.000821917808',
      price: '1460000000',
      amountMinor: 1_200_000n,
      feeMinor: 3_500n,
      taxMinor: 1_200n,
      proceedsAccountId: bca,
    });
    // 21,8% of the BTC at cost 3.890.000 → realized +351.273 (design +352.000 at its cost 3.886.667).
    expect(sold.realizedMinor).toBe(351_273n);
    expect(await balance(bibit)).toBe(5_000_000n - 3_890_000n);
    expect(await balance(bca)).toBe(50_000_000n + 1_195_300n);
    expect(sold.transferTransactionId).not.toBeNull();
    const kept = await trade({
      kind: 'sell',
      clientId: randomUUID(),
      assetId: btc.id,
      occurredAt: at('2026-10-15'),
      units: '0.000000000001',
      amountMinor: 0n,
      proceedsAccountId: bca,
    });
    expect([kept.transactionId, kept.transferTransactionId]).toEqual([null, null]);
    const spy = await createSpy();
    await buy(spy.id, '1', 60_000n);
    for (const [extra, code] of [
      [{ proceedsAccountId: bca }, 'INVALID_TRADE'],
      [{ units: '2' }, 'INVALID_TRADE'],
      [{ amountMinor: -1n }, 'INVALID_TRADE'],
      [{ feeMinor: 70_000n }, 'INVALID_TRADE'],
      [{ feeMinor: -1n }, 'INVALID_TRADE'],
      [{ units: 'abc' }, 'INVALID_TRADE'],
      [{ fxRate: 'x' }, 'INVALID_TRADE'],
      [{ fxRate: '0' }, 'INVALID_TRADE'],
    ] as const) {
      await expect(
        trade({
          kind: 'sell',
          clientId: randomUUID(),
          assetId: spy.id,
          occurredAt: at('2026-10-15'),
          units: '0.5',
          amountMinor: 34_000n,
          ...extra,
        }),
      ).rejects.toMatchObject({ code });
    }
  });

  it('FR-G5: a sale of an asset held by two goals needs the reduced goal; the others keep their units', async () => {
    const spy = await createSpy();
    await buy(spy.id, '1', 60_000n);
    await allocate(spy.id, [
      [goalA, 'percent', 6000],
      [goalB, 'percent', 4000],
    ]);
    const sell = (extra: Partial<TradeRecord>) =>
      trade({
        kind: 'sell',
        clientId: randomUUID(),
        assetId: spy.id,
        occurredAt: at('2026-10-15'),
        units: '0.2',
        amountMinor: 13_800n,
        ...extra,
      } as TradeRecord);
    await expect(sell({})).rejects.toMatchObject({ code: 'INVALID_TRADE' });
    await expect(sell({ reduceGoalId: randomUUID() })).rejects.toMatchObject({
      code: 'INVALID_TRADE',
    });
    const sold = await sell({ reduceGoalId: goalA });
    expect(sold.reducedGoalId).toBe(goalA);
    // DP Rumah 0,6 − 0,2 = 0,4 of 0,8 (50%); Dana Pensiun keeps 0,4 (50%).
    expect(await sources(spy.id)).toEqual([
      { goal_id: goalA, mode: 'percent', pct_bps: 5000 },
      { goal_id: goalB, mode: 'percent', pct_bps: 5000 },
    ]);
    await expect(sell({ reduceGoalId: goalA, units: '5' })).rejects.toMatchObject({
      code: 'INVALID_TRADE',
    });
    await sell({ reduceGoalId: goalA, units: '0.4' });
    expect(await sources(spy.id)).toEqual([{ goal_id: goalB, mode: 'percent', pct_bps: 10_000 }]);
  });

  it('FR-G5: selling the whole position needs no goal choice and keeps the goals’ percentages for new units', async () => {
    const spy = await createSpy();
    await buy(spy.id, '1', 60_000n);
    await allocate(spy.id, [
      [goalA, 'percent', 6000],
      [goalB, 'percent', 4000],
    ]);
    const sold = await trade({
      kind: 'sell',
      clientId: randomUUID(),
      assetId: spy.id,
      occurredAt: at('2026-10-15'),
      units: '1',
      amountMinor: 69_010n,
    });
    expect(sold.reducedGoalId).toBeNull();
    expect(await sources(spy.id)).toEqual([
      { goal_id: goalA, mode: 'percent', pct_bps: 6000 },
      { goal_id: goalB, mode: 'percent', pct_bps: 4000 },
    ]);
    const asset = await asApp(() => repo().asset(userId, spy.id));
    expect([asset.holding.units, asset.goals.map((row) => row.valueBaseMinor)]).toEqual(['0', [0n, 0n]]);
    // The next DCA buy splits 60/40 again.
    await buy(spy.id, '0.5', 34_505n, { occurredAt: at('2026-10-16') });
    expect((await asApp(() => repo().asset(userId, spy.id))).goals.map((row) => row.units)).toEqual(['0.3', '0.2']);
  });

  it('dividend: kept in cash, paid into an account, or reinvested', async () => {
    const vea = await createSpy({ symbol: 'VEA' });
    await buy(vea.id, '4', 24_000n);
    const cash = await trade({
      kind: 'dividend',
      clientId: randomUUID(),
      assetId: vea.id,
      occurredAt: at('2026-10-08'),
      amountMinor: 700n,
      taxMinor: 120n,
      mode: 'cash',
    });
    expect([cash.dividendMinor, cash.dividendMode]).toEqual([580n, 'cash']);
    expect(await test.query('SELECT type FROM transactions WHERE id = $1', [cash.transactionId])).toEqual([
      { type: 'dividend' },
    ]);
    const paid = await trade({
      kind: 'dividend',
      clientId: randomUUID(),
      assetId: vea.id,
      occurredAt: at('2026-10-08'),
      amountMinor: 100n,
      mode: 'account',
      accountId: wise,
    });
    expect([paid.proceedsAccountId, await balance(wise)]).toEqual([wise, 100n]);
    const drip = await trade({
      kind: 'dividend',
      clientId: randomUUID(),
      assetId: vea.id,
      occurredAt: at('2026-10-08'),
      amountMinor: 61n,
      mode: 'reinvest',
      units: '0.01',
    });
    expect([drip.transactionId, drip.units]).toEqual([null, '0.01']);
    for (const extra of [
      { mode: 'account', accountId: bca },
      { mode: 'account' },
      { amountMinor: 0n },
      { feeMinor: 701n },
      { mode: 'reinvest' },
    ]) {
      await expect(
        trade({
          kind: 'dividend',
          clientId: randomUUID(),
          assetId: vea.id,
          occurredAt: at('2026-10-08'),
          amountMinor: 700n,
          mode: 'cash',
          ...extra,
        } as TradeRecord),
      ).rejects.toMatchObject({ code: 'INVALID_TRADE' });
    }
    const portfolio = await asApp(() => repo().portfolio(userId));
    // Each at its trade-date rate: 94.830 + 16.350 + 9.974.
    expect(portfolio.dividends.totalMinor).toBe(121_154n);
  });

  it('cash top-up: a transfer into the platform, idempotent', async () => {
    const input: TradeRecord = {
      kind: 'cash_topup',
      clientId: randomUUID(),
      accountId: bibit,
      fromAccountId: bca,
      occurredAt: at('2026-10-14'),
      sentMinor: 3_000_000n,
    };
    const topup = await trade(input);
    expect(await trade(input)).toEqual(topup);
    expect([topup.assetId, topup.amountMinor, await balance(bibit)]).toEqual([null, 3_000_000n, 8_000_000n]);
    expect((await asApp(() => repo().trades(userId, { accountId: bibit }))).map((row) => row.kind)).toEqual([
      'cash_topup',
    ]);
    await asApp(() => repo().removeTrade(userId, topup.id));
    expect(await balance(bibit)).toBe(5_000_000n);
  });

  it('refuses a trade without a rate to the base currency, or in a closed period', async () => {
    const spy = await createSpy();
    await test.query(`DELETE FROM fx_rates`);
    await expect(buy(spy.id, '1', 100n)).rejects.toMatchObject({ code: 'FX_RATE_MISSING' });
    await test.query(
      `INSERT INTO periods (user_id, label, start_date, end_date, days, status, closed_at) VALUES ($1, '2026-09', '2026-09-01', '2026-09-30', 30, 'closed', now())`,
      [userId],
    );
    await expect(buy(spy.id, '1', 100n, { occurredAt: at('2026-09-15'), fxRate: '16000' })).rejects.toMatchObject({
      code: 'PERIOD_CLOSED',
    });
    await expect(buy(spy.id, '1', 0n, { fxRate: '16000' })).rejects.toMatchObject({ code: 'INVALID_TRADE' });
    await expect(buy(randomUUID(), '1', 1n)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('adjustHoldings ("Sesuaikan kepemilikan")', () => {
  const adjust = (assetId: string, units: string, reason: 'unrecorded_buy' | 'drip' | 'correction', extra = {}) =>
    asApp(() =>
      repo().adjustHoldings(userId, {
        clientId: randomUUID(),
        assetId,
        occurredAt: at('2026-10-15'),
        units,
        reason,
        ...extra,
      }),
    );

  it('more units: an unrecorded buy (cost, no cash), a DRIP (no cost), or a correction; fewer: a correction', async () => {
    const spy = await createSpy();
    const opening = await adjust(spy.id, '1.197', 'unrecorded_buy', { amountMinor: 69_725n, fxRate: '16349.86' });
    expect([opening.kind, opening.transactionId, await balance(gotrade)]).toEqual(['buy', null, 100_000n]);
    const drip = await adjust(spy.id, '1.215', 'drip', { price: '690.10' });
    expect([drip.kind, drip.dividendMode, drip.amountMinor, drip.units]).toEqual([
      'dividend',
      'reinvest',
      1_242n,
      '0.018',
    ]);
    await adjust(spy.id, '1.3', 'correction');
    expect((await adjust(spy.id, '1.25', 'correction')).reducedGoalId).toBeNull();
    await adjust(spy.id, '1.3', 'correction');
    await allocate(spy.id, [
      [goalA, 'percent', 6000],
      [goalB, 'percent', 4000],
    ]);
    await expect(adjust(spy.id, '1.1', 'correction')).rejects.toMatchObject({ code: 'INVALID_TRADE' });
    const lower = await adjust(spy.id, '1.1', 'correction', { reduceGoalId: goalB });
    expect([lower.kind, lower.units, lower.reducedGoalId]).toEqual(['adjust', '-0.2', goalB]);
    const asset = await asApp(() => repo().asset(userId, spy.id));
    expect(asset.holding.units).toBe('1.1');
    expect(asset.goals.map((row) => row.bps)).toEqual([7090, 2909]);
  });

  it('refuses matching, negative, or non-numeric units, a lower DRIP, and an unpriced purchase; replays by client id', async () => {
    const spy = await createSpy();
    const clientId = randomUUID();
    const input = {
      clientId,
      assetId: spy.id,
      occurredAt: at('2026-10-15'),
      units: '1',
      reason: 'correction' as const,
    };
    const first = await asApp(() => repo().adjustHoldings(userId, input));
    expect(await asApp(() => repo().adjustHoldings(userId, input))).toEqual(first);
    await expect(adjust(spy.id, '1', 'correction')).rejects.toMatchObject({ code: 'INVALID_TRADE' });
    await expect(adjust(spy.id, '-1', 'correction')).rejects.toMatchObject({ code: 'INVALID_TRADE' });
    await expect(adjust(spy.id, 'x', 'correction')).rejects.toMatchObject({ code: 'INVALID_TRADE' });
    await expect(adjust(spy.id, '0.5', 'drip', { price: '1' })).rejects.toMatchObject({ code: 'INVALID_TRADE' });
    await expect(adjust(spy.id, '2', 'unrecorded_buy')).rejects.toMatchObject({ code: 'INVALID_TRADE' });
  });
});

describe('removeTrade', () => {
  it('soft-deletes the cash legs and replays; refuses when a later sale would oversell', async () => {
    const spy = await createSpy();
    const first = await buy(spy.id, '1', 60_000n);
    const second = await buy(spy.id, '1', 65_000n, { occurredAt: at('2026-10-05') });
    await trade({
      kind: 'sell',
      clientId: randomUUID(),
      assetId: spy.id,
      occurredAt: at('2026-10-10'),
      units: '1.5',
      amountMinor: 100_000n,
      proceedsAccountId: wise,
    });
    await expect(asApp(() => repo().removeTrade(userId, second.id))).rejects.toMatchObject({ code: 'INVALID_TRADE' });
    const sale = (await asApp(() => repo().trades(userId, { assetId: spy.id }))).find((row) => row.kind === 'sell');
    await asApp(() => repo().removeTrade(userId, sale?.id as string));
    await asApp(() => repo().removeTrade(userId, second.id));
    expect(await balance(wise)).toBe(0n);
    expect((await asApp(() => repo().asset(userId, spy.id))).holding).toMatchObject({ units: '1', costMinor: 60_000n });
    expect(await test.query('SELECT count(*)::int AS n FROM transactions WHERE deleted_at IS NULL')).toEqual([
      { n: 1 },
    ]);
    const adjusted = await asApp(() =>
      repo().adjustHoldings(userId, {
        clientId: randomUUID(),
        assetId: spy.id,
        occurredAt: at('2026-10-11'),
        units: '2',
        reason: 'correction',
      }),
    );
    await asApp(() => repo().removeTrade(userId, adjusted.id));
    await expect(asApp(() => repo().removeTrade(userId, randomUUID()))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(first.kind).toBe('buy');
  });
});

describe('portfolio (FR-I3)', () => {
  it('values holdings and cash per platform, against the targets, leaving unrated currencies out', async () => {
    const spy = await createSpy();
    await buy(spy.id, '1', 60_000n);
    const euro = await account('investment', 'Degiro', 'EUR', 10_000n);
    // Held without a rate to IDR (unvalued), and held without any price (at cost).
    const vwce = await createSpy({ accountId: euro, symbol: 'VWCE' });
    const ori = await asApp(() =>
      repo().createAsset(userId, {
        accountId: bibit,
        symbol: 'ORI',
        name: 'ORI026',
        assetClass: 'indonesia',
        market: 'sbn',
      }),
    );
    for (const [assetId, units, amountMinor] of [
      [vwce.id, '1', 13_000n],
      [ori.id, '1500000', 1_482_000n],
    ] as const) {
      await asApp(() =>
        repo().adjustHoldings(userId, {
          clientId: randomUUID(),
          assetId,
          occurredAt: at('2026-08-31'),
          units,
          reason: 'unrecorded_buy',
          amountMinor,
          fxRate: '1',
        }),
      );
    }
    await account('investment', 'Closed', 'IDR', 0n, 'archived');
    const empty = await asApp(() => repo().portfolio(userId));
    expect(empty.allocation).toBeNull();
    await asApp(() => repo().setTargets(userId, { us_stocks: 8000, cash: 2000 }));
    const portfolio = await asApp(() => repo().portfolio(userId));
    expect(
      portfolio.platforms.map((row) => [row.name, row.cashMinor, row.holdingsValueBaseMinor, row.valueBaseMinor]),
    ).toEqual([
      ['Gotrade', 40_000n, 11_283_135n, 11_283_135n + 6_540_000n],
      ['Bibit', 5_000_000n, 1_482_000n, 6_482_000n],
      ['Degiro', 10_000n, null, null],
    ]);
    expect(portfolio.missingRates).toEqual(['EUR']);
    expect(portfolio.targets).toEqual({ us_stocks: 8000, cash: 2000 });
    expect(portfolio.summary.valueBaseMinor).toBe(11_283_135n + 6_540_000n + 6_482_000n);
    expect(portfolio.summary.unpricedCount).toBe(1);
    expect(portfolio.allocation?.rows.map((row) => row.key)).toEqual(['us_stocks', 'cash', 'indonesia']);
    expect(euro).toBeTruthy();
    expect(portfolio.today).toBe('2026-10-15' as LocalDate);
  });

  it('records and replaces daily snapshots (real clock by default)', async () => {
    const investments = createInvestments(test.db);
    const snapshot = {
      date: '2026-09-30' as LocalDate,
      valueBaseMinor: 57_700_000n,
      costBaseMinor: 50_900_000n,
      contributionsBaseMinor: 0n,
    };
    await asApp(() => investments.recordSnapshot(userId, snapshot));
    await asApp(() =>
      investments.recordSnapshot(userId, { ...snapshot, contributionsBaseMinor: 3_000_000n, breakdown: { cash: '1' } }),
    );
    expect(await asApp(() => investments.snapshots(userId))).toEqual([
      { ...snapshot, contributionsBaseMinor: 3_000_000n, breakdown: { cash: '1' } },
    ]);
    expect((await asApp(() => investments.portfolio(userId))).platforms).toHaveLength(2);
  });
});
