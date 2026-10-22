// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/investments.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`. A and B each get an IDR platform with cash, a bank account, a
 * "Daftar saya" category, an asset bought once, allocation targets, and a goal holding half the asset; B's calls aimed
 * at A's platform, asset, category, accounts, or goal are refused and leave A's rows as they were.
 */
import { randomUUID } from 'node:crypto';
import type { TradeView } from '@wf/db/investments';
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import type { GoalAssetOption, InvestmentsOverview } from '../../../src/server/fn/investments.ts';
import {
  aId,
  as,
  bId,
  type Case,
  type LocalDate,
  type Name,
  NOT_FOUND,
  ok,
  services,
  SOME_ID,
  superuser,
  UNAUTHENTICATED,
} from '../harness.ts';

export interface InvestmentSetup {
  readonly platform: string;
  readonly bank: string;
  readonly category: string;
  readonly asset: string;
  readonly goal: string;
}

const setups: Partial<Record<'A' | 'B', Promise<InvestmentSetup>>> = {};
const TRADED = new Date('2026-10-05T03:00:00Z');

/** The user's portfolio (platform, bank, category, asset, targets, goal on half the asset), made once. */
export function investmentSetUpOf(user: 'A' | 'B'): Promise<InvestmentSetup> {
  setups[user] ??= (async () => {
    const userId = user === 'A' ? aId : bId;
    const label = user === 'A' ? 'Rahasia A' : 'Milik B';
    const account = async (type: 'investment' | 'bank', name: string) =>
      (
        await services.accounts.create(userId, {
          type,
          providerName: 'Penyedia',
          displayName: `${label} ${name}`,
          currency: 'IDR',
          openingBalanceMinor: 5_000_000n,
          openingDate: '2026-10-01' as LocalDate,
          color: 'cyan',
        })
      ).id;
    const platform = await account('investment', 'platform');
    const bank = await account('bank', 'bank');
    const category = (
      await services.investments.createCategory(userId, { name: `${label} kategori`, assetClass: 'indonesia' })
    ).id;
    const asset = (
      await services.investments.createAsset(userId, {
        accountId: platform,
        symbol: user === 'A' ? 'RHSA' : 'MLKB',
        name: `${label} saham`,
        assetClass: 'indonesia',
        market: 'idx_equity',
        categoryId: category,
        manualPrice: '1000',
        manualPriceAt: TRADED,
      })
    ).id;
    await services.investments.recordTrade(userId, {
      kind: 'buy',
      clientId: randomUUID(),
      assetId: asset,
      occurredAt: TRADED,
      units: '100',
      price: '1000',
      amountMinor: 100_000n,
    });
    await services.investments.setTargets(userId, { indonesia: 6000, cash: 4000 });
    const goal = (
      await services.goals.create(userId, {
        name: `${label} tujuan aset`,
        icon: 'target',
        color: 'green',
        targetMinor: 1_000_000n,
        currency: 'IDR',
        deadlineMonth: null,
        tag: null,
        assetSources: [{ assetId: asset, mode: 'percent', pctBps: 5000 }],
      })
    ).id;
    return { platform, bank, category, asset, goal };
  })();
  return setups[user];
}

/** A's investment rows as stored; B's calls must leave them unchanged. */
const aRows = async () => ({
  assets: await superuser`SELECT * FROM assets WHERE user_id = ${aId} ORDER BY id`,
  trades: await superuser`SELECT * FROM investment_trades WHERE user_id = ${aId} ORDER BY id`,
  categories: await superuser`SELECT * FROM asset_categories WHERE user_id = ${aId} ORDER BY id`,
  targets: await superuser`SELECT * FROM allocation_targets WHERE user_id = ${aId} ORDER BY asset_class`,
  sources: await superuser`SELECT * FROM goal_funding_sources WHERE user_id = ${aId} ORDER BY id`,
  transactions: await superuser`SELECT id, deleted_at FROM transactions WHERE user_id = ${aId} ORDER BY id`,
});

/** Calls `fn` as B with `input` (aimed at A): refused (with `expected` when given), A's rows unchanged. */
async function refusedForB(fn: Name, input: unknown, expected?: unknown): Promise<void> {
  const before = await aRows();
  const answer = await as('B', fn, input);
  if (expected === undefined) expect(answer).toMatchObject({ ok: false });
  else expect(answer).toEqual(expected);
  expect(await aRows()).toEqual(before);
}

const both = async () => ({ a: await investmentSetUpOf('A'), b: await investmentSetUpOf('B') });

const buy = (assetId: string, overrides: object = {}) => ({
  kind: 'buy',
  clientId: randomUUID(),
  occurredAt: new Date('2026-10-07T03:00:00Z'),
  assetId,
  units: '1',
  price: '1000',
  amountMinor: 1_000n,
  ...overrides,
});

const newAsset = (accountId: string, symbol: string, overrides: object = {}) => ({
  accountId,
  symbol,
  name: symbol,
  assetClass: 'indonesia' as const,
  market: 'idx_equity' as const,
  ...overrides,
});

export const cases = {
  getInvestments: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const { a, b } = await both();
      const ofB = await as<Result<InvestmentsOverview>>('B', 'getInvestments', input);
      expect(ofB.ok && ofB.value.portfolio.assets.map((asset) => asset.id)).toEqual([b.asset]);
      expect(ofB.ok && ofB.value.portfolio.categories.map((category) => category.id)).toEqual([b.category]);
      expect(ofB.ok && ofB.value.portfolio.platforms.map((platform) => platform.accountId)).toEqual([b.platform]);
      expect(ofB.ok && ofB.value.goals.map((goal) => goal.id)).toContain(b.goal);
      expect(ofB.ok && ofB.value.goals.map((goal) => goal.id)).not.toContain(a.goal);
      expect(ofB.ok && ofB.value.portfolio.assets[0]?.goals.map((goal) => goal.goalId)).toEqual([b.goal]);
    },
  },
  getAssetTrades: {
    input: () => ({ assetId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const { a, b } = await both();
      await refusedForB('getAssetTrades', { assetId: a.asset }, NOT_FOUND);
      const own = await as<Result<TradeView[]>>('B', 'getAssetTrades', { assetId: b.asset });
      expect(own.ok && own.value.map((trade) => [trade.kind, trade.assetId])).toEqual([['buy', b.asset]]);
    },
  },
  listInvestmentAssets: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const { b } = await both();
      const ofB = await as<Result<GoalAssetOption[]>>('B', 'listInvestmentAssets', input);
      expect(ofB.ok && ofB.value.map((asset) => [asset.id, asset.goals.map((goal) => goal.goalId)])).toEqual([
        [b.asset, [b.goal]],
      ]);
    },
  },
  createInvestmentAsset: {
    input: () => newAsset(SOME_ID, 'ANON'),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const { a, b } = await both();
      await refusedForB('createInvestmentAsset', newAsset(a.platform, 'PWND'), NOT_FOUND);
      await refusedForB('createInvestmentAsset', newAsset(b.platform, 'PWND', { categoryId: a.category }));
      expect(await as('B', 'createInvestmentAsset', newAsset(b.platform, 'BARU'))).toMatchObject(
        ok({ symbol: 'BARU', accountId: b.platform }),
      );
    },
  },
  updateInvestmentAsset: {
    input: () => ({ id: SOME_ID, patch: { name: 'Pwned' } }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const { a, b } = await both();
      await refusedForB('updateInvestmentAsset', { id: a.asset, patch: { name: 'Pwned' } }, NOT_FOUND);
      await refusedForB('updateInvestmentAsset', { id: b.asset, patch: { categoryId: a.category } });
      expect(await as('B', 'updateInvestmentAsset', { id: b.asset, patch: { name: 'Milik B saham' } })).toMatchObject(
        ok({ name: 'Milik B saham' }),
      );
    },
  },
  removeInvestmentAsset: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const { a, b } = await both();
      await refusedForB('removeInvestmentAsset', { id: a.asset }, NOT_FOUND);
      const made = await services.investments.createAsset(bId, newAsset(b.platform, 'HAPUS'));
      expect(await as('B', 'removeInvestmentAsset', { id: made.id })).toEqual(ok(null));
    },
  },
  moveInvestmentAsset: {
    input: () => ({ assetId: SOME_ID, categoryId: null }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const { a, b } = await both();
      await refusedForB('moveInvestmentAsset', { assetId: a.asset, categoryId: null });
      await refusedForB('moveInvestmentAsset', { assetId: b.asset, categoryId: a.category }, NOT_FOUND);
      expect(await as('B', 'moveInvestmentAsset', { assetId: b.asset, categoryId: b.category })).toEqual(ok(null));
    },
  },
  setAllocationTargets: {
    input: () => ({ targets: { indonesia: 10_000 } }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await both();
      const before = await aRows();
      expect(await as('B', 'setAllocationTargets', input)).toEqual(ok(null));
      expect(await aRows()).toEqual(before);
      expect(await superuser`SELECT asset_class, target_bps FROM allocation_targets WHERE user_id = ${bId}`).toEqual([
        { asset_class: 'indonesia', target_bps: 10_000 },
      ]);
    },
  },
  recordInvestmentTrade: {
    input: () => buy(SOME_ID),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const { a, b } = await both();
      await refusedForB('recordInvestmentTrade', buy(a.asset), NOT_FOUND);
      await refusedForB('recordInvestmentTrade', buy(b.asset, { kind: 'sell', proceedsAccountId: a.bank }));
      await refusedForB('recordInvestmentTrade', buy(b.asset, { kind: 'sell', reduceGoalId: a.goal }));
      await refusedForB('recordInvestmentTrade', {
        kind: 'dividend',
        clientId: randomUUID(),
        occurredAt: new Date('2026-10-07T03:00:00Z'),
        assetId: b.asset,
        amountMinor: 1_000n,
        mode: 'account',
        accountId: a.bank,
      });
      await refusedForB('recordInvestmentTrade', {
        kind: 'cash_topup',
        clientId: randomUUID(),
        occurredAt: new Date('2026-10-07T03:00:00Z'),
        accountId: b.platform,
        fromAccountId: a.bank,
        sentMinor: 1_000n,
      });
      expect(await as('B', 'recordInvestmentTrade', buy(b.asset))).toMatchObject(ok({ kind: 'buy', assetId: b.asset }));
    },
  },
  adjustInvestmentHoldings: {
    input: () => ({
      clientId: randomUUID(),
      assetId: SOME_ID,
      occurredAt: new Date('2026-10-07T03:00:00Z'),
      units: '1',
      reason: 'correction',
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const { a, b } = await both();
      const fields = input as Record<string, unknown>;
      await refusedForB('adjustInvestmentHoldings', { ...fields, assetId: a.asset, units: '200' }, NOT_FOUND);
      expect(
        await as('B', 'adjustInvestmentHoldings', {
          ...fields,
          clientId: randomUUID(),
          assetId: b.asset,
          units: '102',
        }),
      ).toMatchObject(ok({ kind: 'adjust', assetId: b.asset }));
    },
  },
  setAssetGoals: {
    input: () => ({ assetId: SOME_ID, sources: [] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const { a, b } = await both();
      await refusedForB('setAssetGoals', { assetId: a.asset, sources: [] }, NOT_FOUND);
      await refusedForB(
        'setAssetGoals',
        { assetId: b.asset, sources: [{ goalId: a.goal, mode: 'whole' }] },
        { ok: false, code: 'INVALID_GOAL' },
      );
      expect(
        await as('B', 'setAssetGoals', {
          assetId: b.asset,
          sources: [{ goalId: b.goal, mode: 'percent', pctBps: 4000 }],
        }),
      ).toEqual(ok(null));
    },
  },
} satisfies Partial<Record<Name, Case>>;
