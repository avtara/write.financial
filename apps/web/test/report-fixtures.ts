// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Deterministic "Laporan" fixtures built from the `ReportView` shape (packages/db/src/reports.ts), with the same
 * numbers as the design (§A): September 2026 final against August, 121 transactions, and net worth 112,2 jt.
 */
import type { ReportSummary, ReportView } from '@wf/db/reports';
import { reportTotals, totalsDelta } from '@wf/domain/report';
import type { LocalDate } from '@wf/domain/period';

/** The month the fixtures are built around. */
export const TODAY = '2026-10-23' as LocalDate;

/** `LocalDate` is a branded string; the fixtures write plain literals. */
const d = (value: string) => value as LocalDate;

const SEPTEMBER_NET_WORTH = {
  valueMinor: 112_200_000n,
  cashMinor: 54_500_000n,
  investmentsMinor: 57_700_000n,
  debtMinor: 0n,
  missingPortfolio: false,
  unvaluedCurrencies: ['USD'],
  asOf: d('2026-09-30'),
};

const AUGUST_TOTALS = reportTotals({ incomeMinor: 24_900_000n, expenseMinor: 16_900_000n, txCount: 118 });
const SEPTEMBER_TOTALS = reportTotals({
  incomeMinor: 25_800_000n,
  expenseMinor: 18_300_000n,
  txCount: 121,
  netWorthMinor: 112_200_000n,
});

/** A final monthly view with every section filled (the design's September). */
export const FINAL_VIEW: ReportView = {
  id: 'report-2026-09',
  kind: 'monthly',
  status: 'final',
  periodId: 'period-sep',
  label: '2026-09',
  range: { from: d('2026-09-01'), to: d('2026-09-30') },
  compare: { label: '2026-08', range: { from: d('2026-08-01'), to: d('2026-08-31') } },
  totals: SEPTEMBER_TOTALS,
  previous: AUGUST_TOTALS,
  delta: totalsDelta(SEPTEMBER_TOTALS, AUGUST_TOTALS),
  sections: {
    categories: [
      {
        categoryId: 'c1',
        name: 'Sewa Kos',
        group: 'needs',
        isFixed: true,
        spentMinor: 4_500_000n,
        shareBps: 2459,
        limitMinor: 4_500_000n,
        usedBps: 10_000,
        overMinor: 0n,
      },
      {
        categoryId: 'c2',
        name: 'Belanja Online',
        group: 'wants',
        isFixed: false,
        spentMinor: 2_600_000n,
        shareBps: 1420,
        limitMinor: 2_000_000n,
        usedBps: 13_000,
        overMinor: 600_000n,
      },
      {
        categoryId: null,
        name: null,
        group: null,
        isFixed: null,
        spentMinor: 150_000n,
        shareBps: 82,
        limitMinor: null,
        usedBps: null,
        overMinor: 0n,
      },
    ],
    incomeSources: [
      { categoryId: 'c10', name: 'Gaji', group: 'active', totalMinor: 20_000_000n, shareBps: 7752 },
      { categoryId: 'c11', name: 'Freelance', group: 'passive', totalMinor: 5_800_000n, shareBps: 2248 },
    ],
    merchants: [
      { merchant: 'GoPay', totalMinor: 3_200_000n, count: 34, shareBps: 1749 },
      { merchant: 'Indomaret', totalMinor: 1_100_000n, count: 12, shareBps: 601 },
    ],
    tags: [{ tagId: 't1', name: 'akhir-pekan', totalMinor: 1_200_000n, count: 9 }],
    accounts: [
      { accountId: 'a1', name: 'BCA Tahapan', type: 'bank', inMinor: 25_000_000n, outMinor: 15_000_000n },
      { accountId: 'a2', name: 'GoPay', type: 'ewallet', inMinor: 800_000n, outMinor: 3_300_000n },
    ],
    goals: [
      {
        goalId: 'g1',
        name: 'Dana Darurat',
        currency: 'IDR',
        valuation: 'cash',
        savedMinor: 7_625_000n,
        openingMinor: 5_825_000n,
        targetMinor: 54_000_000n,
        progressBps: 1412,
      },
      {
        goalId: 'g2',
        name: 'Porto Saham',
        currency: 'USD',
        valuation: 'market',
        savedMinor: null,
        openingMinor: null,
        targetMinor: 100_000_000n,
        progressBps: null,
      },
    ],
    goalsAsOf: d('2026-09-30'),
    largest: [
      {
        transactionId: 'tx1',
        date: d('2026-09-01'),
        description: 'Sewa Kos',
        merchant: null,
        amountMinor: 4_500_000n,
        shareBps: 2459,
      },
      {
        transactionId: 'tx2',
        date: d('2026-09-14'),
        description: 'Laptop baru',
        merchant: 'Tokopedia',
        amountMinor: 2_400_000n,
        shareBps: 1311,
      },
      {
        transactionId: 'tx3',
        date: d('2026-09-14'),
        description: 'Tiket kereta',
        merchant: 'KAI',
        amountMinor: 450_000n,
        shareBps: 246,
      },
    ],
    largestShareBps: 4000,
    subscriptions: { active: 5, monthlyMinor: 845_900n, yearlyMinor: 10_150_800n, shareBps: 462, unconverted: 1 },
    days: [
      { date: d('2026-09-01'), outMinor: 4_500_000n },
      { date: d('2026-09-07'), outMinor: 1_200_000n },
      { date: d('2026-09-10'), outMinor: 800_000n },
      { date: d('2026-09-13'), outMinor: 3_200_000n },
      { date: d('2026-09-20'), outMinor: 600_000n },
    ],
    averageDailyMinor: 610_000n,
    busiestWeek: { from: d('2026-09-07'), to: d('2026-09-13'), totalMinor: 5_200_000n },
    netWorth: SEPTEMBER_NET_WORTH,
    netWorthHistory: [
      {
        date: d('2026-04-30'),
        valuation: {
          ...SEPTEMBER_NET_WORTH,
          valueMinor: 85_200_000n,
          cashMinor: 30_000_000n,
          investmentsMinor: 55_200_000n,
          asOf: d('2026-04-30'),
        },
      },
      { date: d('2026-05-31'), valuation: null },
      {
        date: d('2026-06-30'),
        valuation: {
          ...SEPTEMBER_NET_WORTH,
          valueMinor: 95_500_000n,
          cashMinor: 38_000_000n,
          investmentsMinor: 57_500_000n,
          asOf: d('2026-06-30'),
        },
      },
      { date: d('2026-09-30'), valuation: SEPTEMBER_NET_WORTH },
    ],
  },
  generatedAt: new Date('2026-10-01T02:00:00Z'),
};

/** A bare provisional view (a quarter) with empty sections, for the badge and empty-section tests. */
export const PROVISIONAL_VIEW: ReportView = {
  id: 'report-2026-q3',
  kind: 'quarterly',
  status: 'provisional',
  periodId: null,
  label: '2026-Q3',
  range: { from: d('2026-07-01'), to: d('2026-09-30') },
  compare: { label: '2026-04-01/2026-06-30', range: { from: d('2026-04-01'), to: d('2026-06-30') } },
  totals: reportTotals({ incomeMinor: 70_000_000n, expenseMinor: 50_000_000n, txCount: 350 }),
  previous: null,
  delta: totalsDelta(reportTotals({ incomeMinor: 70_000_000n, expenseMinor: 50_000_000n, txCount: 350 }), null),
  sections: {
    categories: [],
    incomeSources: [],
    merchants: [],
    tags: [],
    accounts: [],
    goals: [],
    goalsAsOf: null,
    largest: [],
    largestShareBps: null,
    subscriptions: { active: 5, monthlyMinor: 845_900n, yearlyMinor: 10_150_800n, shareBps: 462, unconverted: 0 },
    days: [],
    averageDailyMinor: 0n,
    busiestWeek: null,
    netWorth: null,
    netWorthHistory: [],
  },
  generatedAt: new Date('2026-10-01T02:00:00Z'),
};

/** A provisional custom-range view ("1–15 Okt"), for the custom picker tests. */
export const CUSTOM_VIEW: ReportView = {
  ...PROVISIONAL_VIEW,
  id: 'report-custom',
  kind: 'custom',
  label: '2026-10-01/2026-10-15',
  range: { from: d('2026-10-01'), to: d('2026-10-15') },
  compare: null,
};

/** A saved-report summary of one month, in the shape `getReportsHome` returns. */
export function summary(
  label: string,
  overrides: { readonly kind?: ReportSummary['kind']; readonly id?: string } = {},
): ReportSummary {
  const id = overrides.id ?? `report-${label}`;
  return {
    id,
    kind: overrides.kind ?? 'monthly',
    periodId: (overrides.kind ?? 'monthly') === 'monthly' ? `period-${label}` : null,
    status: 'final',
    label,
    range:
      label.length === 7 && !label.includes('Q')
        ? { from: d(`${label}-01`), to: d(`${label}-28`) }
        : { from: d('2026-07-01'), to: d('2026-09-30') },
    totals: reportTotals({ incomeMinor: 25_800_000n, expenseMinor: 18_300_000n, txCount: 121 }),
  };
}
