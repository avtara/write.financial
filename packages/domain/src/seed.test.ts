// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { BUILT_IN_CATEGORIES, type BuiltInCategory, type BuiltInCategoryKey } from './categories.ts';
import { goalShares } from './goal-assets.ts';
import { replayTrades, type TradeInput } from './investments.ts';
import { availableBalance } from './ledger.ts';
import { DESIGN_SEED, seedClosingBalances, type DesignSeed, type SeedTransaction } from './seed.ts';
import type { LocalDate } from './period.ts';
import { cancelledSavings, remainingInMonth, subscriptionTotals } from './subscriptions.ts';
import { TAG_SLUG_PATTERN } from './tags.ts';
import { allocation, classItems, portfolioSummary, type PositionInput } from './valuation.ts';

type Flow = Extract<SeedTransaction, { kind: 'expense' | 'income' }>;

const { accounts, transactions, septemberTransactions } = DESIGN_SEED;
const flows = transactions.filter((transaction): transaction is Flow => transaction.kind !== 'transfer');
const expenses = flows.filter((transaction) => transaction.kind === 'expense');
const incomes = flows.filter((transaction) => transaction.kind === 'income');
const transfers = transactions.filter((transaction) => transaction.kind === 'transfer');
const CATEGORY: Partial<Record<BuiltInCategoryKey, BuiltInCategory>> = Object.fromEntries(
  BUILT_IN_CATEGORIES.map((category) => [category.key, category]),
);
const total = (rows: readonly Flow[]): bigint => rows.reduce((sum, row) => sum + row.amountMinor, 0n);
const inCategory = (key: BuiltInCategoryKey) => expenses.filter((expense) => expense.categoryKey === key);
const septemberFlows = septemberTransactions.filter(
  (transaction): transaction is Flow => transaction.kind !== 'transfer',
);
const septemberExpenses = septemberFlows.filter((transaction) => transaction.kind === 'expense');
const septemberIncomes = septemberFlows.filter((transaction) => transaction.kind === 'income');
const septemberTransfers = septemberTransactions.filter((transaction) => transaction.kind === 'transfer');
const inSeptemberCategory = (key: BuiltInCategoryKey) =>
  septemberExpenses.filter((expense) => expense.categoryKey === key);

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

  it('golden: Belanja = Erafone 2.150.000 + Shopee 250.000', () => {
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

describe('DESIGN_SEED September (Section 10 "Laporan September 2026", the closed period)', () => {
  it('golden: 121 transactions = 4 income + 114 expense + 3 transfers', () => {
    expect(septemberTransactions).toHaveLength(121);
    expect(septemberIncomes).toHaveLength(4);
    expect(septemberExpenses).toHaveLength(114);
    expect(septemberTransfers).toHaveLength(3);
  });

  it('golden: income Rp25.800.000, expenses Rp18.300.000, transfers Rp7.500.000', () => {
    expect(total(septemberIncomes)).toBe(25_800_000n);
    expect(total(septemberExpenses)).toBe(18_300_000n);
    expect(septemberTransfers.reduce((sum, transfer) => sum + transfer.sentMinor, 0n)).toBe(7_500_000n);
  });

  it.each([
    ['system:rent', 4_500_000n],
    ['system:food', 3_400_000n],
    ['system:transport', 1_600_000n],
    ['system:bills', 1_400_000n],
    ['system:health', 300_000n],
    ['system:shopping', 2_600_000n],
    ['system:entertainment', 1_800_000n],
    ['system:hobby', 900_000n],
    ['system:subscriptions', 850_000n],
    ['system:gifts', 700_000n],
    ['system:personal_care', 250_000n],
  ] as const)('golden report: %s spends %d', (key, amount) => {
    expect(total(inSeptemberCategory(key))).toBe(amount);
  });

  it('golden: the 9.9 sale — 7 Shopee orders including Kursi kerja ergonomis 1.050.000 on 9 Sep', () => {
    const shopee = inSeptemberCategory('system:shopping').filter((expense) => expense.merchant === 'Shopee');
    expect(shopee).toHaveLength(7);
    expect(shopee.find((expense) => expense.description === 'Kursi kerja ergonomis')).toMatchObject({
      amountMinor: 1_050_000n,
      occurredAt: expect.stringMatching(/^2026-09-09T/) as unknown,
    });
  });

  it('golden: Tokopedia Sepatu lari 449.000 on 27 Sep is the largest transaction of 25–30 Sep', () => {
    const [largest] = septemberFlows
      .filter((flow) => flow.occurredAt >= '2026-09-25')
      .toSorted((a, b) => (a.amountMinor < b.amountMinor ? 1 : -1));
    expect(largest).toMatchObject({
      merchant: 'Tokopedia',
      description: 'Sepatu lari',
      amountMinor: 449_000n,
      occurredAt: expect.stringMatching(/^2026-09-27T/) as unknown,
    });
  });

  it('dates every transaction 1–30 Sep 2026 in WIB, in chronological order', () => {
    for (const transaction of septemberTransactions) {
      expect(transaction.occurredAt).toMatch(/^2026-09-(0[1-9]|[12]\d|30)T([01]\d|2[0-3]):[0-5]\d:00\+07:00$/);
    }
    const times = septemberTransactions.map((transaction) => transaction.occurredAt);
    expect(times).toEqual([...times].sort());
  });

  it('matches category kind to transaction kind, uses positive amounts and seed accounts, at most 5 slug tags', () => {
    const keys = accounts.map((account) => account.key);
    for (const flow of septemberFlows) {
      expect(CATEGORY[flow.categoryKey]?.kind).toBe(flow.kind);
      expect(flow.amountMinor).toBeGreaterThan(0n);
      expect(keys).toContain(flow.accountKey);
    }
    for (const transfer of septemberTransfers) {
      expect(transfer.receivedMinor).toBeGreaterThan(0n);
      expect(keys).toContain(transfer.fromAccountKey);
      expect(keys).toContain(transfer.toAccountKey);
    }
    for (const transaction of septemberTransactions) {
      expect(transaction.tags.length).toBeLessThanOrEqual(5);
      for (const tag of transaction.tags) expect(tag).toMatch(TAG_SLUG_PATTERN);
    }
  });

  it('closed September on 1 Okt; periods start on the 1st', () => {
    expect(DESIGN_SEED.periodStartDay).toBe(1);
    expect(DESIGN_SEED.closedPeriods).toEqual([
      { start: '2026-09-01', end: '2026-09-30', closedAt: '2026-10-01T00:05:00+07:00' },
    ]);
  });
});

describe('DESIGN_SEED budgets (Section 06 "Riwayat perubahan")', () => {
  it('golden: one version from 2026-09 with 10 lines totalling Rp18.750.000', () => {
    expect(DESIGN_SEED.budgets).toHaveLength(1);
    const [version] = DESIGN_SEED.budgets;
    expect(version?.effectiveFrom).toBe('2026-09');
    expect(version?.expectedIncomeMinor).toBe(26_000_000n);
    const lines = version?.lines ?? [];
    expect(lines).toHaveLength(10);
    expect(lines.reduce((sum, line) => sum + line.limitMinor, 0n)).toBe(18_750_000n);
    expect(lines.filter((line) => line.isFixed).map((line) => line.categoryKey)).toEqual([
      'system:rent',
      'system:bills',
      'system:subscriptions',
    ]);
    for (const line of lines) {
      expect(line).toMatchObject({ rollover: false, alertPct: 85 });
      expect(CATEGORY[line.categoryKey]?.kind).toBe('expense');
    }
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
      // Platform cash only (M5): Gotrade US$51,99; the rest is in holdings, Bibit's 3.000.000 paid the RDPU buy.
      gotrade: 5_199n,
      indodax: 0n,
      stockbit: 0n,
      pluang: 0n,
      bibit: 0n,
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

  it('opens every account on 31 Agu 2026 with the 30 Sep balances minus September; only Gotrade is in USD', () => {
    for (const account of accounts) expect(account.openingDate).toBe('2026-08-31');
    expect(Object.fromEntries(accounts.map((account) => [account.key, account.openingBalanceMinor]))).toEqual({
      bca: 38_415_000n,
      jago: 5_125_000n,
      mandiri: 2_440_000n,
      gopay: 2_382_000n,
      ovo: 1_541_000n,
      cash: 2_120_000n,
      // US$51,63 on 30 Sep − the US$305,81 top-up + the US$305,80 of 1 Sep buys.
      gotrade: 5_162n,
      indodax: 0n,
      stockbit: 0n,
      pluang: 0n,
      bibit: 0n,
    });
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

  it('golden: Dana Darurat is 3× monthly spending; the "Dana tidak rutin" are sinking funds', () => {
    expect(DESIGN_SEED.goals.map((goal) => [goal.name, goal.kind, goal.targetMonths])).toEqual([
      ['Dana Darurat', 'savings', 3],
      ['DP Rumah', 'savings', null],
      ['Dana Pensiun', 'savings', null],
      ['Liburan Bali', 'sinking', null],
      ['Servis motor', 'sinking', null],
      ['Perpanjang STNK', 'sinking', null],
    ]);
  });

  it('golden: Rp17.325.000 of the available accounts is allocated (design "Rp17.300.000", "bebas Rp37.700.000")', () => {
    const closing = seedClosingBalances(DESIGN_SEED);
    const sources = DESIGN_SEED.goals.flatMap((goal) => goal.sources);
    const valueOf = (source: (typeof sources)[number]) =>
      source.mode === 'whole' ? (closing.get(source.accountKey) ?? 0n) : (source.amountMinor ?? 0n);
    const allocated = sources.reduce((sum, source) => sum + valueOf(source), 0n);
    expect(allocated).toBe(17_325_000n);
    expect(55_023_000n - allocated).toBe(37_698_000n);
    // BCA Tahapan "4 tujuan": DP Rumah 5.000.000 + "Rp4.200.000 dipakai dana tidak rutin".
    const bca = sources.filter((source) => source.accountKey === 'bca');
    expect(bca).toHaveLength(4);
    expect(bca.reduce((sum, source) => sum + valueOf(source), 0n)).toBe(9_200_000n);
    // Dana Darurat's Bank Jago is a fixed amount (all of it today), so set-asides into Bank Jago can count elsewhere.
    expect(sources.filter((source) => source.mode === 'whole')).toEqual([]);
    expect(DESIGN_SEED.goals[0]?.sources).toEqual([{ accountKey: 'jago', mode: 'fixed', amountMinor: 8_125_000n }]);
    expect(closing.get('jago')).toBe(8_125_000n);
    for (const source of sources) {
      expect(accounts.find((account) => account.key === source.accountKey)?.includeInAvailable).toBe(true);
      expect(source.mode === 'fixed').toBe(source.amountMinor !== null);
    }
  });
});

describe('DESIGN_SEED subscriptions (Section 07 "Langganan", 15 Okt)', () => {
  const { subscriptions } = DESIGN_SEED;
  const active = subscriptions.filter((subscription) => subscription.state.status === 'active');
  const today = '2026-10-15' as LocalDate;

  it('golden: 7 active Rp904.900/bulan, Rp11.520.000/tahun (≈), 1 paused, 3 cancelled', () => {
    expect(active.map((subscription) => subscription.name)).toEqual([
      'Netflix',
      'Spotify',
      'YouTube Premium',
      'ChatGPT',
      'Fit Hub',
      'iCloud+',
      'Niagahoster',
    ]);
    expect(subscriptionTotals(active)).toEqual({
      monthlyMinor: 904_900n,
      yearlyMinor: 11_519_700n,
      approxYearlyMinor: 11_520_000n,
    });
    expect(subscriptions.filter((subscription) => subscription.state.status === 'paused')).toHaveLength(1);
    expect(subscriptions.filter((subscription) => subscription.state.status === 'cancelled')).toHaveLength(3);
  });

  it('golden: Oktober still to pay Rp660.900 in 4 bills, 18–28 Okt (iCloud+ 9 Okt is overdue, not counted)', () => {
    const bills = active.map((subscription) => ({
      dueDate: subscription.nextBillingDate as LocalDate,
      amountMinor: subscription.priceMinor,
      status: subscription.nextBillingDate < today ? ('unconfirmed' as const) : ('scheduled' as const),
    }));
    expect(remainingInMonth(bills, today)).toEqual({
      totalMinor: 660_900n,
      count: 4,
      firstDue: '2026-10-18',
      lastDue: '2026-10-28',
    });
  });

  it('golden: the cancelled ones saved Rp1.195.000 so far', () => {
    const cancelled = subscriptions.flatMap((subscription) =>
      subscription.state.status === 'cancelled'
        ? [
            {
              priceMinor: subscription.priceMinor,
              cycle: subscription.cycle,
              endsOn: subscription.state.endsOn as LocalDate,
            },
          ]
        : [],
    );
    expect(cancelledSavings(cancelled, today).totalMinor).toBe(1_195_000n);
  });

  it('golden: Netflix Rp186.000 on the 18th from BCA with an H-1 reminder; earlier bills paid by seed transactions', () => {
    expect(subscriptions[0]).toMatchObject({
      name: 'Netflix',
      priceMinor: 186_000n,
      nextBillingDate: '2026-10-18',
      accountKey: 'bca',
      remindDaysBefore: 1,
    });
    const everything = [...DESIGN_SEED.septemberTransactions, ...DESIGN_SEED.transactions];
    for (const { name, priceMinor, paid } of subscriptions) {
      for (const bill of paid) {
        expect(
          everything.filter(
            (row) =>
              row.kind === 'expense' &&
              row.occurredAt === bill.occurredAt &&
              row.merchant === name &&
              row.amountMinor === priceMinor,
          ),
        ).toHaveLength(1);
      }
    }
  });
});

describe('DESIGN_SEED recurrences (Section 00 "Setoran rutin & investasi")', () => {
  it('golden: 1st Kantong darurat 500.000 + Gotrade 6.000.000, 14th Bibit 3.000.000, 25th Sisihkan 1.150.000', () => {
    expect(
      DESIGN_SEED.recurrences.map((recurrence) => [recurrence.monthDay, recurrence.toAccountKey, recurrence.sentMinor]),
    ).toEqual([
      [1, 'jago', 500_000n],
      [1, 'gotrade', 6_000_000n],
      [14, 'bibit', 3_000_000n],
      [25, 'jago', 1_150_000n],
    ]);
    const [kantong, , bibit, sisihkan] = DESIGN_SEED.recurrences;
    expect(sisihkan?.allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0n)).toBe(1_150_000n);
    const goals = new Set(DESIGN_SEED.goals.map((goal) => goal.name));
    for (const allocation of sisihkan?.allocations ?? []) expect(goals.has(allocation.goal)).toBe(true);
    // Dana Darurat "Rp3.500.000/bulan · tgl 1 & 14".
    expect([...(kantong?.allocations ?? []), ...(bibit?.allocations ?? [])]).toEqual([
      { goal: 'Dana Darurat', amountMinor: 500_000n, startMonth: '2026-09', endMonth: null },
      { goal: 'Dana Darurat', amountMinor: 3_000_000n, startMonth: '2026-10', endMonth: null },
    ]);
  });

  it('golden: the set-aside runs each sinking fund from October to its due month, into an account no goal holds wholly', () => {
    const sisihkan = DESIGN_SEED.recurrences[3];
    expect(sisihkan?.allocations.map((part) => [part.goal, part.startMonth, part.endMonth])).toEqual(
      DESIGN_SEED.goals
        .filter((goal) => goal.kind === 'sinking')
        .map((goal) => [goal.name, '2026-10', goal.deadlineMonth]),
    );
    for (const recurrence of DESIGN_SEED.recurrences) {
      for (const part of recurrence.allocations) {
        const others = DESIGN_SEED.goals.filter((goal) => goal.name !== part.goal);
        const held = others.flatMap((goal) => goal.sources).filter((source) => source.mode === 'whole');
        expect(held.map((source) => source.accountKey)).not.toContain(recurrence.toAccountKey);
        expect(part.endMonth === null || part.startMonth <= part.endMonth).toBe(true);
      }
    }
  });

  it('golden: the monthly plan is Rp4.650.000 ("dari rencana Rp4.650.000"), every split adds up to its transfer', () => {
    const planned = DESIGN_SEED.recurrences.flatMap((recurrence) => recurrence.allocations);
    expect(planned.reduce((sum, allocation) => sum + allocation.amountMinor, 0n)).toBe(4_650_000n);
    for (const recurrence of DESIGN_SEED.recurrences) {
      if (recurrence.allocations.length === 0) continue;
      expect(recurrence.allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0n)).toBe(
        recurrence.sentMinor,
      );
    }
  });

  it('points every paid occurrence at the seed transfer that paid it', () => {
    const everything = [...DESIGN_SEED.septemberTransactions, ...DESIGN_SEED.transactions];
    for (const recurrence of DESIGN_SEED.recurrences) {
      for (const bill of recurrence.paid) {
        const transfer = everything.find((row) => row.kind === 'transfer' && row.occurredAt === bill.occurredAt);
        expect(transfer).toMatchObject({
          fromAccountKey: recurrence.fromAccountKey,
          toAccountKey: recurrence.toAccountKey,
        });
      }
    }
  });
});

describe('DESIGN_SEED receivables (Section 19 "Piutang" `KZZZy`, 15 Okt)', () => {
  const remaining = (receivable: DesignSeed['receivables'][number]) =>
    receivable.payments.reduce((left, payment) => left - payment.amountMinor, receivable.amountMinor);

  it('golden: Rp542.500 outstanding from 2 people — Nadia 242.500 (due 18 Okt) and Raka 300.000 of 400.000', () => {
    const active = DESIGN_SEED.receivables.filter((receivable) => remaining(receivable) > 0n);
    expect(active.map((receivable) => [receivable.counterparty, remaining(receivable), receivable.dueDate])).toEqual([
      ['Nadia', 242_500n, '2026-10-18'],
      ['Raka Pratama', 300_000n, '2026-10-31'],
    ]);
    expect(active.reduce((sum, receivable) => sum + remaining(receivable), 0n)).toBe(542_500n);
    expect(DESIGN_SEED.receivables.find((receivable) => receivable.counterparty === 'Nadia')).toMatchObject({
      source: 'split_bill',
      accountKey: 'bca',
      remind: true,
    });
  });

  it('golden: Dimas 150.000 (2 Okt, GoPay) and Sari 385.000 (21 Sep, BCA) paid back within 90 days', () => {
    const settled = DESIGN_SEED.receivables.filter(
      (receivable) => remaining(receivable) === 0n && (receivable.payments.at(-1)?.receivedAt ?? '') >= '2026-07-17',
    );
    expect(
      settled.map((receivable) => [receivable.counterparty, receivable.amountMinor, receivable.payments.at(-1)]),
    ).toEqual([
      ['Dimas', 150_000n, { amountMinor: 150_000n, accountKey: 'gopay', receivedAt: '2026-10-02T12:00:00+07:00' }],
      ['Sari', 385_000n, { amountMinor: 385_000n, accountKey: 'bca', receivedAt: '2026-09-21T12:00:00+07:00' }],
    ]);
  });

  it('never repays more than the principal, after lending, from seed accounts', () => {
    const keys = new Set(accounts.map((account) => account.key));
    for (const receivable of DESIGN_SEED.receivables) {
      expect(remaining(receivable)).toBeGreaterThanOrEqual(0n);
      expect(keys.has(receivable.accountKey)).toBe(true);
      expect(receivable.remind).toBe(receivable.dueDate !== null && receivable.counterparty === 'Nadia');
      for (const payment of receivable.payments) {
        expect(keys.has(payment.accountKey)).toBe(true);
        expect(payment.receivedAt > receivable.lentAt).toBe(true);
      }
    }
  });
});

describe('DESIGN_SEED investments (design 09, 15 Okt 16.42 WIB, USD Rp16.350)', () => {
  const { investments } = DESIGN_SEED;
  const currencies = (currency: string) => ({ quote: currency, base: 'IDR' });
  const accountCurrency = new Map(accounts.map((account) => [account.key, account.currency]));
  const holdingOf = (key: string) => {
    const asset = investments.assets.find((candidate) => candidate.key === key);
    if (asset === undefined) throw new Error(`no asset ${key}`);
    const trades: TradeInput[] = [
      ...(asset.opening === null
        ? []
        : [
            {
              kind: 'buy' as const,
              status: 'settled' as const,
              units: asset.opening.units,
              amountMinor: asset.opening.amountMinor,
              feeMinor: 0n,
              taxMinor: 0n,
              fxRate: asset.opening.fxRate,
              dividendMode: null,
            },
          ]),
      ...asset.buys.map((buy) => ({
        kind: 'buy' as const,
        status: buy.pending ? ('pending' as const) : ('settled' as const),
        units: buy.units,
        amountMinor: buy.amountMinor,
        feeMinor: 0n,
        taxMinor: 0n,
        fxRate: accountCurrency.get(asset.accountKey) === 'IDR' ? '1' : '16350',
        dividendMode: null,
      })),
    ];
    return { asset, holding: replayTrades(trades, currencies(accountCurrency.get(asset.accountKey) as string)) };
  };
  const positions: PositionInput[] = [
    ...investments.assets.map((asset): PositionInput => {
      const { holding } = holdingOf(asset.key);
      const currency = accountCurrency.get(asset.accountKey) as string;
      return {
        key: asset.key,
        assetClass: asset.assetClass,
        currency,
        units: holding.units,
        price: asset.price,
        prevClose: null,
        fxRate: currency === 'IDR' ? '1' : '16350',
        prevFxRate: null,
        costMinor: holding.costMinor,
        costBaseMinor: holding.costBaseMinor,
      };
    }),
    // Gotrade's cash, US$51,99 (Rp850.037), class "Kas & SGOV".
    {
      key: 'cash:gotrade',
      assetClass: 'cash',
      currency: 'USD',
      units: '51.99',
      price: '1',
      prevClose: null,
      fxRate: '16350',
      prevFxRate: null,
      costMinor: 5_199n,
      costBaseMinor: 850_037n,
    },
  ];

  it('golden: Rp61.420.000 value, Rp53.931.000 cost, +Rp7.489.000 (+13,9%) through the valuation', () => {
    expect(seedClosingBalances(DESIGN_SEED).get('gotrade')).toBe(5_199n);
    const summary = portfolioSummary(positions, { base: 'IDR', dividends12mBaseMinor: 0n });
    expect([summary.valueBaseMinor, summary.costBaseMinor, summary.gainBaseMinor, summary.gainBps]).toEqual([
      61_420_000n,
      53_931_000n,
      7_489_000n,
      1389,
    ]);
    const value = (key: string) => summary.positions.find((position) => position.key === key)?.valueBaseMinor;
    // Per platform: Gotrade 45.420.000 (US$2.778), Indodax 5.500.000, Stockbit 4.300.000, Pluang 3.700.000, Bibit
    // 2.500.000; the RDPU being bought is not part of the value.
    const byPlatform = (key: string) =>
      investments.assets
        .filter((asset) => asset.accountKey === key)
        .reduce((sum, asset) => sum + (value(asset.key) ?? 0n), key === 'gotrade' ? 850_037n : 0n);
    expect(['gotrade', 'indodax', 'stockbit', 'pluang', 'bibit'].map(byPlatform)).toEqual([
      45_420_000n,
      5_500_000n,
      4_300_000n,
      3_700_000n,
      2_500_000n,
    ]);
    expect([value('spy'), value('rdpu')]).toEqual([13_500_000n, 0n]);
    expect(holdingOf('spy').holding.costBaseMinor).toBe(11_400_000n);
  });

  it('drift 3,8% against targets 50/12/12/7/8/5/6 (the design panel says 3,1% from shares its holdings do not have)', () => {
    const summary = portfolioSummary(positions, { base: 'IDR', dividends12mBaseMinor: 0n });
    expect(Object.values(investments.targets).reduce((sum, bps) => sum + bps, 0)).toBe(10_000);
    expect(allocation(classItems(summary.positions), investments.targets).driftBps).toBe(381);
  });

  it('golden: goals hold Rp22.400.000 of it (RDPU 3.000.000 diproses, SPY 60/40, IDX30, SCHD)', () => {
    const goalsBy = new Map<string, { goalId: string; mode: 'whole' | 'percent'; bps: number }[]>();
    for (const goal of DESIGN_SEED.goals) {
      for (const source of goal.assetSources) {
        const list = goalsBy.get(source.assetKey) ?? [];
        list.push({ goalId: goal.name, mode: source.mode, bps: source.pctBps ?? 10_000 });
        goalsBy.set(source.assetKey, list);
      }
    }
    const summary = portfolioSummary(positions, { base: 'IDR', dividends12mBaseMinor: 0n });
    const held = [...goalsBy].flatMap(([key, sources]) => {
      const valued = summary.positions.find((position) => position.key === key)?.valueBaseMinor ?? 0n;
      const pending = investments.assets.find((asset) => asset.key === key)?.buys.find((buy) => buy.pending);
      return goalShares(valued + (pending?.amountMinor ?? 0n), sources).goals;
    });
    expect(held.reduce((sum, share) => sum + share.value, 0n)).toBe(22_400_000n);
    expect(held.filter((share) => share.goalId === 'DP Rumah').map((share) => share.value)).toEqual([
      8_100_000n,
      1_000_000n,
    ]);
  });

  it('puts every asset on an investment account in its currency, categories by name, one pending buy', () => {
    const platforms = new Set(
      accounts.filter((account) => account.type === 'investment').map((account) => account.key),
    );
    const categories = new Set(investments.categories.map((category) => category.name));
    for (const asset of investments.assets) {
      expect(platforms.has(asset.accountKey)).toBe(true);
      expect(asset.category === null || categories.has(asset.category)).toBe(true);
    }
    expect(investments.assets).toHaveLength(23);
    expect(investments.assets.flatMap((asset) => asset.buys.filter((buy) => buy.pending)).length).toBe(1);
  });
});

describe('seedClosingBalances', () => {
  const base: DesignSeed = {
    ...DESIGN_SEED,
    transactions: [],
    septemberTransactions: [],
    investments: { ...DESIGN_SEED.investments, assets: [] },
  };

  it('is the opening balance without transactions', () => {
    expect(seedClosingBalances(base).get('bca')).toBe(38_415_000n);
  });

  it('golden: the 30 Sep balances after September only', () => {
    expect(seedClosingBalances({ ...DESIGN_SEED, transactions: [] }).get('bca')).toBe(41_610_000n);
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
    expect(closing.get('ovo')).toBe(1_536_000n);
    expect(closing.get('cash')).toBe(2_103_650n);
    expect(closing.get('gotrade')).toBe(5_262n);
  });

  it('subtracts the buys paid from platform cash, pending ones too', () => {
    const [spy] = DESIGN_SEED.investments.assets;
    if (spy === undefined) throw new Error('fixture changed');
    const buy = { occurredAt: '2026-10-01T09:00:00+07:00', units: '1', price: '1', amountMinor: 100n };
    const seed: DesignSeed = {
      ...base,
      investments: {
        ...base.investments,
        assets: [
          {
            ...spy,
            buys: [
              { ...buy, pending: false },
              { ...buy, pending: true },
            ],
          },
        ],
      },
    };
    expect(seedClosingBalances(seed).get('gotrade')).toBe(5_162n - 200n);
    expect(() =>
      seedClosingBalances({ ...seed, investments: { ...seed.investments, assets: [{ ...spy, accountKey: 'nope' }] } }),
    ).toThrow('unknown seed account: nope');
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
