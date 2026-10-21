// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Pure rules of "Utang & cicilan" (PRD §6.13 FR-R7, FR-U1–U5) shared by the server functions and the screens: a
 * card's cycle and status, its next statement, the schedule of a card installment, the allocation of a payment to a
 * card with the recalculated installment and the card after it, the page KPIs, and the user's payment priority.
 * Amounts are minor units; KPIs are in the base currency (cards and debts in another currency are left out).
 */
import type {
  CardAllocationInput,
  CardView,
  DebtView,
  InstallmentInput,
  InstallmentView,
  RecalculationInput,
} from '@wf/db/debts';
import {
  cardCycle,
  cardStatus,
  INSTALLMENT_TENORS,
  statementAmount,
  type CardCycle,
  type CardStatus,
} from '@wf/domain/creditcard';
import {
  allocateCardPayment,
  CC_PAYMENT_BUCKETS,
  DEFAULT_CC_PAYMENT_PRIORITY,
  installmentSchedule,
  recalculateAfterPayoff,
  type CardPaymentAllocation,
  type CcPaymentBucket,
  type Installment,
  type RecalcMode,
} from '@wf/domain/debt';
import type { LocalDate } from '@wf/domain/period';

/** The stored `user_preferences.cc_payment_priority` as an order of both buckets; anything else is the default. */
export function paymentPriority(stored: readonly string[]): CcPaymentBucket[] {
  const valid =
    stored.length === CC_PAYMENT_BUCKETS.length && CC_PAYMENT_BUCKETS.every((bucket) => stored.includes(bucket));
  return [...(valid ? (stored as readonly CcPaymentBucket[]) : DEFAULT_CC_PAYMENT_PRIORITY)];
}

/** A domain schedule as the repositories store it. */
export function toInstallmentInputs(schedule: readonly Installment[]): InstallmentInput[] {
  return schedule.map((row) => ({
    dueDate: row.dueOn,
    principalMinor: row.principalMinor,
    interestMinor: row.interestMinor,
    feeMinor: row.feeMinor,
  }));
}

/** A schedule row of the repository as the domain's `Installment` (its balance after is not needed here). */
export function toInstallment(row: InstallmentView): Installment {
  return {
    number: row.seq,
    dueOn: row.dueDate,
    principalMinor: row.principalMinor,
    interestMinor: row.interestMinor,
    feeMinor: row.feeMinor,
    totalMinor: row.totalMinor,
    balanceAfterMinor: 0n,
  };
}

/** The rows of a card installment not on a statement yet, in order. */
export function unbilledRows(debt: DebtView): InstallmentView[] {
  return debt.installments.filter((row) => row.status === 'scheduled' && !row.billed);
}

export interface CardState {
  readonly card: CardView;
  /** The cycle containing today; `null` while the card has no statement or due day. */
  readonly cycle: CardCycle | null;
  readonly status: CardStatus;
  /** "Rekening koran {statementOn}": the current bill plus the installment rows billed on that statement. */
  readonly statementMinor: bigint;
}

/** FR-R7 status of `card` on `today`, with its active installments `debts` (any order). */
export function cardState(card: CardView, debts: readonly DebtView[], today: LocalDate): CardState {
  const cycle =
    card.statementDay === null || card.dueDay === null ? null : cardCycle(today, card.statementDay, card.dueDay);
  const status = cardStatus({
    limitMinor: card.limitMinor ?? 0n,
    balanceMinor: card.balanceMinor,
    installmentsMinor: card.installmentsHeldMinor,
  });
  const rows = debts
    .filter((debt) => debt.cardAccountId === card.accountId)
    .flatMap((debt) => unbilledRows(debt).map(toInstallment));
  return {
    card,
    cycle,
    status,
    statementMinor:
      cycle === null ? status.currentBillMinor : statementAmount(status.currentBillMinor, rows, cycle.statementOn),
  };
}

export interface CardInstallmentTerms {
  readonly tenor: (typeof INSTALLMENT_TENORS)[number];
  /** Monthly interest in basis points. */
  readonly monthlyRateBps: number;
  readonly adminFeeMinor: bigint;
}

/**
 * FR-U2 schedule of a card expense of `amountMinor` made on `date` (hNvip: 3.000.000 on 2 Nov in 3× → 1.000.000 on
 * the statements of 20 Nov, 20 Des, 20 Jan): flat interest, the first row on the statement closing the expense's cycle.
 */
export function cardInstallmentSchedule(
  card: { readonly statementDay: number; readonly dueDay: number },
  amountMinor: bigint,
  date: LocalDate,
  terms: CardInstallmentTerms,
): Installment[] {
  return installmentSchedule({
    principalMinor: amountMinor,
    tenor: terms.tenor,
    monthlyRateBps: terms.monthlyRateBps,
    adminFeeMinor: terms.adminFeeMinor,
    method: 'flat',
    firstDue: cardCycle(date, card.statementDay, card.dueDay).statementOn,
  });
}

/** One row of the payment allocation table (qrRRV "SEBELUM · DIBAYAR · SISA"). */
export interface AllocationRow {
  readonly bucket: CcPaymentBucket | 'credit';
  /** `installments` rows only. */
  readonly debt: DebtView | null;
  /** Owed before the payment (`null` for the credit row). */
  readonly beforeMinor: bigint | null;
  readonly paidMinor: bigint;
}

/** The installment a payment paid only partly, with its two FR-U4 recalculations. */
export interface PartialPayoff {
  readonly debt: DebtView;
  /** Principal left after the payment. */
  readonly restMinor: bigint;
  readonly reduce: Installment[];
  readonly shorten: Installment[];
}

export interface CardFigures {
  /** "Utang cicilan": Σ installment principal held against the limit. */
  readonly installmentsMinor: bigint;
  /** "Total kewajiban kartu". */
  readonly owedMinor: bigint;
  readonly remainingLimitMinor: bigint;
  readonly statementMinor: bigint;
}

export interface CardPaymentPlan {
  readonly allocation: CardPaymentAllocation;
  /** In priority order: installments (oldest first) or spending, then the credit row. */
  readonly rows: AllocationRow[];
  readonly partial: PartialPayoff | null;
  /** What the repository stores (parts of 0 left out). */
  readonly parts: CardAllocationInput[];
  readonly recalculations: RecalculationInput[];
  readonly before: CardFigures;
  readonly after: CardFigures;
}

/**
 * FR-U4 payment of `amountMinor` into the card of `state`: allocated by `priority` over its active installments
 * (`debts`, oldest first) and its current bill, the installment paid partly recalculated with `mode`, and the card
 * before and after (qrRRV: 2.000.000 → A 2.000.000, B 0; installments 3.000.000 → 1.000.000, owed 4.000.000 →
 * 2.000.000, limit left 11.000.000 → 13.000.000, statement 2.000.000 → 1.333.334).
 */
export function cardPaymentPlan(input: {
  readonly state: CardState;
  readonly debts: readonly DebtView[];
  readonly amountMinor: bigint;
  readonly priority: readonly CcPaymentBucket[];
  readonly mode: RecalcMode;
}): CardPaymentPlan {
  const { state, priority } = input;
  const installments = input.debts.filter(
    (debt) =>
      debt.cardAccountId === state.card.accountId && debt.status === 'active' && debt.remainingPrincipalMinor > 0n,
  );
  const spendingMinor = state.status.currentBillMinor;
  const allocation = allocateCardPayment(
    input.amountMinor,
    {
      installments: installments.map((debt) => ({ id: debt.id, remainingMinor: debt.remainingPrincipalMinor })),
      spendingMinor,
    },
    priority,
  );
  const paid = new Map(allocation.installments.map((part) => [part.id, part.paidMinor]));
  const rows: AllocationRow[] = priority.flatMap((bucket): AllocationRow[] =>
    bucket === 'spending'
      ? [{ bucket, debt: null, beforeMinor: spendingMinor, paidMinor: allocation.spendingMinor }]
      : installments.map((debt) => ({
          bucket,
          debt,
          beforeMinor: debt.remainingPrincipalMinor,
          paidMinor: paid.get(debt.id) ?? 0n,
        })),
  );
  rows.push({ bucket: 'credit', debt: null, beforeMinor: null, paidMinor: allocation.creditMinor });

  let partial: PartialPayoff | null = null;
  const recalculations: RecalculationInput[] = [];
  const newRows: Installment[] = [];
  for (const debt of installments) {
    const paidMinor = paid.get(debt.id) ?? 0n;
    const remaining = unbilledRows(debt).map(toInstallment);
    if (paidMinor === 0n) {
      newRows.push(...remaining);
      continue;
    }
    if (paidMinor === debt.remainingPrincipalMinor) continue;
    const terms = { remaining, paidMinor, monthlyRateBps: debt.monthlyRateBps, method: debt.interestMethod };
    // Paid oldest first, only one installment can be left partly paid.
    partial = {
      debt,
      restMinor: debt.remainingPrincipalMinor - paidMinor,
      reduce: recalculateAfterPayoff({ ...terms, mode: 'reduce_amount' }),
      shorten: recalculateAfterPayoff({ ...terms, mode: 'shorten_tenor' }),
    };
    const chosen = input.mode === 'reduce_amount' ? partial.reduce : partial.shorten;
    recalculations.push({
      debtId: debt.id,
      mode: input.mode,
      schedule: toInstallmentInputs(chosen),
    });
    newRows.push(...chosen);
  }

  const paidInstallments = allocation.installments.reduce((sum, paid) => sum + paid.paidMinor, 0n);
  const installmentsMinor = state.card.installmentsHeldMinor - paidInstallments;
  const status = cardStatus({
    limitMinor: state.card.limitMinor ?? 0n,
    balanceMinor: state.card.balanceMinor + input.amountMinor,
    installmentsMinor,
  });
  const parts: CardAllocationInput[] = [
    ...allocation.installments.map((part) => ({
      bucket: 'installments' as const,
      debtId: part.id,
      amountMinor: part.paidMinor,
    })),
    ...(allocation.spendingMinor > 0n ? [{ bucket: 'spending' as const, amountMinor: allocation.spendingMinor }] : []),
    ...(allocation.creditMinor > 0n ? [{ bucket: 'credit' as const, amountMinor: allocation.creditMinor }] : []),
  ];
  return {
    allocation,
    rows,
    partial,
    parts,
    recalculations,
    before: {
      installmentsMinor: state.card.installmentsHeldMinor,
      owedMinor: state.status.owedMinor,
      remainingLimitMinor: state.status.remainingLimitMinor,
      statementMinor: state.statementMinor,
    },
    after: {
      installmentsMinor,
      owedMinor: status.owedMinor,
      remainingLimitMinor: status.remainingLimitMinor,
      statementMinor:
        state.cycle === null
          ? status.currentBillMinor
          : statementAmount(status.currentBillMinor, newRows, state.cycle.statementOn),
    },
  };
}

/** "Sisa utang": what the design counts. */
export interface DebtKpis {
  /** Σ remaining principal of active debts + Σ current card bills. */
  readonly remainingMinor: bigint;
  readonly installmentCount: number;
  /** Cards with a current bill. */
  readonly billCount: number;
  /** "Harus dibayar": non-card rows due this month or earlier + every card's next statement. */
  readonly dueMinor: bigint;
  /** What makes up {@link dueMinor} when one card alone does (its subtitle names it). */
  readonly dueCard: CardState | null;
  /** "Jatuh tempo terdekat". */
  readonly nearest: { readonly date: LocalDate; readonly name: string } | null;
}

/** FR-U1 KPIs of active `debts` and `cards` on `today`, in `baseCurrency`. */
export function debtKpis(
  debts: readonly DebtView[],
  cards: readonly CardState[],
  today: LocalDate,
  baseCurrency: string,
): DebtKpis {
  const month = today.slice(0, 7);
  const active = debts.filter((debt) => debt.status === 'active' && debt.currency === baseCurrency);
  const owing = cards.filter((state) => state.card.currency === baseCurrency && state.status.owedMinor > 0n);
  let remainingMinor = 0n;
  let dueMinor = 0n;
  let nearest: DebtKpis['nearest'] = null;
  const consider = (date: LocalDate, name: string) => {
    if (date >= today && (nearest === null || date < nearest.date)) nearest = { date, name };
  };
  for (const debt of active) {
    remainingMinor += debt.remainingPrincipalMinor;
    if (debt.kind === 'card_installment') continue;
    for (const row of debt.installments) {
      if (row.status === 'paid') continue;
      if (row.dueDate.slice(0, 7) <= month) dueMinor += row.totalMinor;
      consider(row.dueDate, debt.name);
    }
  }
  // The subtitle names the card when its statement is all that is due.
  const nonCardDueMinor = dueMinor;
  const dueCards: CardState[] = [];
  for (const state of owing) {
    remainingMinor += state.status.currentBillMinor;
    if (state.statementMinor > 0n) {
      dueMinor += state.statementMinor;
      dueCards.push(state);
    }
    if (state.cycle !== null) consider(state.cycle.dueOn, state.card.name);
  }
  return {
    remainingMinor,
    installmentCount: active.length,
    billCount: owing.filter((state) => state.status.currentBillMinor > 0n).length,
    dueMinor,
    dueCard: dueCards.length === 1 && nonCardDueMinor === 0n ? (dueCards[0] as CardState) : null,
    nearest,
  };
}

/** "67% lunas": the share of the principal no longer owed, in basis points (floor). */
export function paidOffBps(debt: DebtView): number {
  return Number(((debt.principalMinor - debt.remainingPrincipalMinor) * 10_000n) / debt.principalMinor);
}

/** Rows paid (other kinds) or on a statement (cards): "0 dari 3 cicilan tertagih". */
export function settledCount(debt: DebtView): number {
  return debt.installments.filter((row) => row.status === 'paid' || row.billed).length;
}

/** Monthly installments of existing debts (next unsettled row of each, without one-off fees) for FR-U5. */
export function existingMonthlyMinor(debts: readonly DebtView[], baseCurrency: string): bigint {
  return debts
    .filter((debt) => debt.status === 'active' && debt.currency === baseCurrency)
    .reduce((sum, debt) => {
      const next = debt.installments.find((row) => row.status === 'scheduled' && !row.billed);
      return next === undefined ? sum : sum + next.principalMinor + next.interestMinor;
    }, 0n);
}

/**
 * "Bunga … % per bulan" as typed: up to two decimals with a comma or a point, 0–100 → basis points
 * (`1,75` → 175); `null` when it is not such a number.
 */
export function parseRateBps(text: string): number | null {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (match === null) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bps > 10_000 ? null : bps;
}
