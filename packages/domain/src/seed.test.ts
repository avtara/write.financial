// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { BUILT_IN_CATEGORIES, type BuiltInCategory, type BuiltInCategoryKey } from './categories.ts';
import { availableBalance } from './ledger.ts';
import { DESIGN_SEED, seedClosingBalances, type DesignSeed, type SeedTransaction } from './seed.ts';
import { TAG_SLUG_PATTERN } from './tags.ts';

type Flow = Extract<SeedTransaction, { kind: 'expense' | 'income' }>;

const { accounts, transactions } = DESIGN_SEED;
const flows = transactions.filter((transaction): transaction is Flow => transaction.kind !== 'transfer');
const expenses = flows.filter((transaction) => transaction.kind === 'expense');
const incomes = flows.filter((transaction) => transaction.kind === 'income');
const transfers = transactions.filter((transaction) => transaction.kind === 'transfer');
const CATEGORY: Partial<Record<BuiltInCategoryKey, BuiltInCategory>> = Object.fromEntries(
  BUILT_IN_CATEGORIES.map((category) => [category.key, category]),
);
const total = (rows: readonly Flow[]): bigint => rows.reduce((sum, row) => sum + row.amountMinor, 0n);
const inCategory = (key: BuiltInCategoryKey) => expenses.filter((expense) => expense.categoryKey === key);

describe('DESIGN_SEED transactions (Section 00, 1–15 Okt 2026)', () => {
  it('golden: 128 transactions = 4 income + 121 expense + 3 transfers', () => {
    expect(transactions).toHaveLength(128);
    expect(incomes).toHaveLength(4);
    expect(expenses).toHaveLength(121);
    expect(transfers).toHaveLength(3);
  });

  it('golden: income Rp26.000.000, expenses Rp16.500.000 (needs 10.400.000, wants 6.100.000)', () => {
    expect(total(incomes)).toBe(26_000_000n);
    expect(total(expenses)).toBe(16_500_000n);
    expect(total(expenses.filter((expense) => CATEGORY[expense.categoryKey]?.group === 'needs'))).toBe(10_400_000n);
    expect(total(expenses.filter((expense) => CATEGORY[expense.categoryKey]?.group === 'wants'))).toBe(6_100_000n);
  });

  it('golden: transfers to savings total Rp9.500.000, Gotrade at Rp16.350 without FX difference', () => {
    expect(transfers.reduce((sum, transfer) => sum + transfer.sentMinor, 0n)).toBe(9_500_000n);
    const gotrade = transfers.find((transfer) => transfer.toAccountKey === 'gotrade');
    expect(gotrade).toMatchObject({ sentMinor: 6_000_000n, receivedMinor: 36_697n });
    expect(DESIGN_SEED.fxRates).toEqual([{ base: 'USD', quote: 'IDR', rate: '16350', asOf: '2026-10-15' }]);
    // round(6.000.000 / 16.350 × 100) cents, rounded half up.
    expect((6_000_000n * 100n * 2n + 16_350n) / (16_350n * 2n)).toBe(36_697n);
  });

  it.each([
    ['system:rent', 4_500_000n, 1],
    ['system:food', 3_200_000n, 18],
    ['system:transport', 1_400_000n, 49],
    ['system:bills', 1_300_000n, 6],
    ['system:health', 0n, 0],
    ['system:shopping', 2_400_000n, 2],
    ['system:entertainment', 2_100_000n, 39],
    ['system:subscriptions', 900_000n, 4],
    ['system:hobby', 700_000n, 2],
    ['system:personal_care', 0n, 0],
    ['system:gifts', 0n, 0],
  ] as const)('golden budget card: %s spends %d in %d transactions', (key, amount, count) => {
    expect(total(inCategory(key))).toBe(amount);
    expect(inCategory(key)).toHaveLength(count);
  });

  it('golden: Belanja Online = Erafone 2.150.000 + Shopee 250.000', () => {
    expect(inCategory('system:shopping').map((expense) => [expense.merchant, expense.amountMinor])).toEqual([
      ['Erafone', 2_150_000n],
      ['Shopee', 250_000n],
    ]);
  });

  it('dates every transaction 1–15 Okt 2026 in WIB, in chronological order', () => {
    for (const transaction of transactions) {
      expect(transaction.occurredAt).toMatch(/^2026-10-(0[1-9]|1[0-5])T([01]\d|2[0-3]):[0-5]\d:00\+07:00$/);
    }
    const times = transactions.map((transaction) => transaction.occurredAt);
    expect(times).toEqual([...times].sort());
  });

  it('matches category kind to transaction kind and uses positive amounts', () => {
    for (const flow of flows) {
      expect(CATEGORY[flow.categoryKey]?.kind).toBe(flow.kind);
      expect(flow.amountMinor).toBeGreaterThan(0n);
    }
    for (const transfer of transfers) {
      expect(transfer.sentMinor).toBeGreaterThan(0n);
      expect(transfer.receivedMinor).toBeGreaterThan(0n);
      expect(transfer.fromAccountKey).not.toBe(transfer.toAccountKey);
    }
  });

  it('uses at most 5 lowercase slug tags per transaction', () => {
    for (const transaction of transactions) {
      expect(transaction.tags.length).toBeLessThanOrEqual(5);
      for (const tag of transaction.tags) expect(tag).toMatch(TAG_SLUG_PATTERN);
    }
  });

  it('references only seed accounts', () => {
    const keys = accounts.map((account) => account.key);
    expect(new Set(keys).size).toBe(keys.length);
    const referenced = transactions.flatMap((transaction) =>
      transaction.kind === 'transfer'
        ? [transaction.fromAccountKey, transaction.toAccountKey]
        : [transaction.accountKey],
    );
    for (const key of referenced) expect(keys).toContain(key);
  });
});

describe('DESIGN_SEED accounts (Section 05 `ycP7T`)', () => {
  it('golden: closing balances on 15 Okt', () => {
    expect(Object.fromEntries(seedClosingBalances(DESIGN_SEED))).toEqual({
      bca: 42_810_000n,
      jago: 8_125_000n,
      mandiri: 3_240_000n,
      gopay: 412_000n,
      ovo: 86_000n,
      cash: 350_000n,
      gotrade: 277_800n,
      indodax: 5_500_000n,
      stockbit: 4_300_000n,
      pluang: 3_700_000n,
      bibit: 5_500_000n,
    });
  });

  it('golden: available balance of the six spending accounts is Rp55.023.000', () => {
    const closing = seedClosingBalances(DESIGN_SEED);
    const available = accounts.map((account) => ({
      includeInAvailable: account.includeInAvailable,
      balanceBaseMinor: closing.get(account.key) ?? 0n,
    }));
    expect(availableBalance(available)).toBe(55_023_000n);
    expect(accounts.filter((account) => account.includeInAvailable).map((account) => account.key)).toEqual([
      'bca',
      'jago',
      'mandiri',
      'gopay',
      'ovo',
      'cash',
    ]);
    expect(
      accounts.filter((account) => account.type === 'investment').every((account) => !account.includeInAvailable),
    ).toBe(true);
  });

  it('shows at most 3 accounts as cards and has exactly one default quick-entry account', () => {
    expect(accounts.filter((account) => account.showAsCard).map((account) => account.key)).toEqual([
      'bca',
      'jago',
      'gopay',
    ]);
    expect(accounts.filter((account) => account.isDefaultQuickEntry).map((account) => account.key)).toEqual(['bca']);
  });

  it('opens every account on 30 Sep 2026; only Gotrade is in USD', () => {
    for (const account of accounts) expect(account.openingDate).toBe('2026-09-30');
    expect(accounts.filter((account) => account.currency !== 'IDR').map((account) => account.key)).toEqual(['gotrade']);
  });
});

describe('DESIGN_SEED goals (Section 00 card "Tujuan tabungan")', () => {
  it('golden: six goals with slug tags', () => {
    expect(DESIGN_SEED.goals.map((goal) => [goal.name, goal.targetMinor, goal.deadlineMonth])).toEqual([
      ['Dana Darurat', 54_000_000n, '2027-11'],
      ['DP Rumah', 150_000_000n, null],
      ['Dana Pensiun', 500_000_000n, null],
      ['Liburan Bali', 8_000_000n, '2027-03'],
      ['Servis motor', 1_200_000n, '2026-12'],
      ['Perpanjang STNK', 850_000n, '2027-02'],
    ]);
    for (const goal of DESIGN_SEED.goals) expect(goal.tag).toMatch(TAG_SLUG_PATTERN);
  });
});

describe('seedClosingBalances', () => {
  const base: DesignSeed = { ...DESIGN_SEED, transactions: [] };

  it('is the opening balance without transactions', () => {
    expect(seedClosingBalances(base).get('bca')).toBe(41_610_000n);
  });

  it('subtracts expenses and sent amounts, adds income and received amounts', () => {
    const seed: DesignSeed = {
      ...base,
      transactions: [
        {
          kind: 'expense',
          occurredAt: '2026-10-01T10:00:00+07:00',
          accountKey: 'ovo',
          categoryKey: 'system:food',
          amountMinor: 6_000n,
          merchant: null,
          description: null,
          tags: [],
        },
        {
          kind: 'income',
          occurredAt: '2026-10-01T11:00:00+07:00',
          accountKey: 'ovo',
          categoryKey: 'system:cashback',
          amountMinor: 1_000n,
          merchant: null,
          description: null,
          tags: [],
        },
        {
          kind: 'transfer',
          occurredAt: '2026-10-01T12:00:00+07:00',
          fromAccountKey: 'cash',
          toAccountKey: 'gotrade',
          sentMinor: 16_350n,
          receivedMinor: 100n,
          description: null,
          tags: [],
        },
      ],
    };
    const closing = seedClosingBalances(seed);
    expect(closing.get('ovo')).toBe(131_000n);
    expect(closing.get('cash')).toBe(483_650n);
    expect(closing.get('gotrade')).toBe(241_203n);
  });

  it('rejects transactions on unknown accounts', () => {
    const seed: DesignSeed = {
      ...base,
      transactions: [
        {
          kind: 'expense',
          occurredAt: '2026-10-01T10:00:00+07:00',
          accountKey: 'nope',
          categoryKey: 'system:food',
          amountMinor: 1n,
          merchant: null,
          description: null,
          tags: [],
        },
      ],
    };
    expect(() => seedClosingBalances(seed)).toThrow('unknown seed account: nope');
  });
});
