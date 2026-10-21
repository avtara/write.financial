// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Design Section 18 ("Utang & cicilan") as the repositories return it: BCA Visa •• 7710 (limit Rp15.000.000, statement
 * on the 20th, due on the 5th) with the October bill of rHTMd, installment A (Tokopedia — Kulkas 2 pintu,
 * Rp3.000.000 in 3×) before and after the Rp2.000.000 payoff of A7ttc, and the MacBook paylater of v3Igd.
 */
import type { CardView, DebtView, InstallmentView } from '@wf/db/debts';
import type { LocalDate } from '@wf/domain/period';
import type { DebtsOverview } from '../src/server/fn/debts.ts';
import { account, BCA, JAGO } from './ledger-fixtures.ts';
import { transactionRow } from './transaction-fixtures.ts';

const d = (value: string) => value as LocalDate;
const AT = new Date('2026-11-02T07:20:00Z');

export const VISA_ID = 'acc-visa';
export const VISA_ACCOUNT = account({
  id: VISA_ID,
  type: 'credit_card',
  displayName: 'BCA Visa',
  providerName: 'BCA',
  last4: '7710',
  includeInAvailable: false,
  balanceMinor: -1_250_000n,
  balanceBaseMinor: -1_250_000n,
  ccLimitMinor: 15_000_000n,
  ccStatementDay: 20,
  ccDueDay: 5,
  sortOrder: 6,
});

/** The card as `debts.cards` returns it; rHTMd by default (bill Rp1.250.000, nothing held). */
export function visa(overrides: Partial<CardView> = {}): CardView {
  return {
    accountId: VISA_ID,
    name: 'BCA Visa',
    currency: 'IDR',
    limitMinor: 15_000_000n,
    statementDay: 20,
    dueDay: 5,
    balanceMinor: -1_250_000n,
    installmentsHeldMinor: 0n,
    ...overrides,
  };
}

export function installment(
  seq: number,
  dueDate: string,
  principalMinor: bigint,
  overrides: Partial<InstallmentView> = {},
): InstallmentView {
  const view = {
    id: `row-${String(seq)}-${dueDate}`,
    seq,
    dueDate: d(dueDate),
    principalMinor,
    interestMinor: 0n,
    feeMinor: 0n,
    status: 'scheduled' as const,
    paidAt: null,
    transactionId: null,
    billed: false,
    ...overrides,
  };
  return { ...view, totalMinor: view.principalMinor + view.interestMinor + view.feeMinor };
}

/** A debt as `debts.list` returns it; installment A before any payoff by default. */
export function debtView(overrides: Partial<DebtView> = {}): DebtView {
  const installments = overrides.installments ?? [
    installment(1, '2026-11-20', 1_000_000n),
    installment(2, '2026-12-20', 1_000_000n),
    installment(3, '2027-01-20', 1_000_000n),
  ];
  return {
    id: 'debt-a',
    kind: 'card_installment',
    name: 'Tokopedia — Kulkas 2 pintu',
    provider: 'BCA Visa',
    cardAccountId: VISA_ID,
    payFromAccountId: null,
    sourceTransactionId: 'tx-kulkas',
    categoryId: null,
    principalMinor: 3_000_000n,
    currency: 'IDR',
    interestMethod: 'flat',
    monthlyRateBps: 0,
    adminFeeMinor: 0n,
    tenorMonths: 3,
    firstDueDate: d('2026-11-20'),
    recalcMode: null,
    recalculatedAt: null,
    status: 'active',
    paidOffAt: null,
    createdAt: AT,
    updatedAt: AT,
    installments,
    paidEarlyMinor: 0n,
    remainingPrincipalMinor: installments
      .filter((row) => row.status === 'scheduled' && !row.billed)
      .reduce((sum, row) => sum + row.principalMinor, 0n),
    allocations: [],
    ...overrides,
  };
}

/** Installment A on 10 Nov before the payment: 3 × 1.000.000 held, bill B Rp1.000.000 (qrRRV). */
export const KULKAS = debtView();
export const CARD_BEFORE_PAYMENT = visa({ balanceMinor: -4_000_000n, installmentsHeldMinor: 3_000_000n });

/** A7ttc: Rp2.000.000 paid early on 10 Nov, recalculated to 333.334 / 333.333 / 333.333. */
export const KULKAS_AFTER = debtView({
  installments: [
    installment(1, '2026-11-20', 333_334n),
    installment(2, '2026-12-20', 333_333n),
    installment(3, '2027-01-20', 333_333n),
  ],
  paidEarlyMinor: 2_000_000n,
  recalcMode: 'reduce_amount',
  recalculatedAt: new Date('2026-11-10T01:30:00Z'),
  allocations: [{ transactionId: 'tx-pay', amountMinor: 2_000_000n, localDate: d('2026-11-10') }],
});
export const CARD_AFTER_PAYMENT = visa({ balanceMinor: -2_000_000n, installmentsHeldMinor: 1_000_000n });

/** v3Igd saved: MacBook Air M4 — iBox, Kredivo 0%, 12 × 1.583.250 from 25 Nov, paid from BCA Tahapan. */
export const MACBOOK = debtView({
  id: 'debt-macbook',
  kind: 'zero_percent',
  name: 'MacBook Air M4 — iBox',
  provider: 'Kredivo',
  cardAccountId: null,
  payFromAccountId: BCA.id,
  sourceTransactionId: null,
  principalMinor: 18_999_000n,
  tenorMonths: 12,
  firstDueDate: d('2026-11-25'),
  installments: Array.from({ length: 12 }, (_, index) =>
    installment(index + 1, new Date(Date.UTC(2026, 10 + index, 25)).toISOString().slice(0, 10), 1_583_250n),
  ),
});

/** rHTMd's October card transactions. */
export const OCTOBER_BILL = [
  transactionRow('tx-superindo', {
    accountId: VISA_ID,
    localDate: d('2026-10-12'),
    description: 'Superindo — belanja bulanan',
    amountMinor: -450_000n,
  }),
  transactionRow('tx-shopee', {
    accountId: VISA_ID,
    localDate: d('2026-10-14'),
    description: 'Shopee — sepatu lari',
    amountMinor: -320_000n,
  }),
  transactionRow('tx-pertamina', {
    accountId: VISA_ID,
    localDate: d('2026-10-15'),
    description: 'Pertamina — bensin',
    amountMinor: -480_000n,
  }),
];

/** The Debts page data; exCE7 (no debt, no card) by default. */
export function debtsOverview(overrides: Partial<DebtsOverview> = {}): DebtsOverview {
  return {
    today: d('2026-10-15'),
    accounts: { baseCurrency: 'IDR', accounts: [BCA, JAGO], availableMinor: 48_060_000n, missingRates: [] },
    debts: [],
    cards: [],
    priority: ['installments', 'spending'],
    receivablesMinor: 0n,
    month: { incomeMinor: 26_000_000n, expenseMinor: 16_500_000n },
    ...overrides,
  };
}

/** rHTMd on 15 Okt: the card with its October bill. */
export const BILL_OVERVIEW = debtsOverview({
  accounts: {
    baseCurrency: 'IDR',
    accounts: [BCA, JAGO, VISA_ACCOUNT],
    availableMinor: 48_060_000n,
    missingRates: [],
  },
  cards: [{ ...visa(), transactions: OCTOBER_BILL }],
});

/** A7ttc on 10 Nov: installment A after the payoff and bill B. */
export const PAID_OVERVIEW = debtsOverview({
  today: d('2026-11-10'),
  accounts: BILL_OVERVIEW.accounts,
  debts: [{ ...KULKAS_AFTER, sourceDate: d('2026-11-02') }],
  cards: [
    {
      ...CARD_AFTER_PAYMENT,
      transactions: [
        transactionRow('tx-superindo-b', {
          accountId: VISA_ID,
          localDate: d('2026-11-06'),
          description: 'Superindo — belanja bulanan',
          amountMinor: -1_000_000n,
        }),
      ],
    },
  ],
});
