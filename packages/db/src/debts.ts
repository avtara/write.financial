// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Debts and installment plans (FR-U1–U6) and credit card payments (FR-U4, FR-R7) as the user manages them (wf_app).
 * Schedules, early-payoff recalculations, and allocation priorities are computed by `@wf/domain/debt` in the caller;
 * this repository validates their invariants (counts, sums, ordering, ≤ remaining) and stores them. A card
 * installment is paid with the card: each row is billed on its card statement on its due date. Other installments
 * are paid by an expense from "Bayar dari", proposed through the Review queue (FR-U6, `materializeIn`) or recorded
 * with `payInstallment`. All amounts are minor units of the debt currency (= its account's currency) unless noted.
 */
import type { DebtKind, InterestMethod, RecalcMode } from '@wf/domain/debt';
import { parseLocalDate, type LocalDate } from '@wf/domain/period';
import { toBase } from '@wf/domain/transactions';
import { and, asc, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { viewsIn as accountViewsIn } from './accounts.ts';
import { firstRow, withUser, type Database, type Transaction } from './db.ts';
import { checkCategoryIn, localDateOf, recordTransactionIn, userContextIn, valuationIn } from './ledger-core.ts';
import { LedgerError } from './ledger-errors.ts';
import { materializeIn, userClockIn } from './occurrences.ts';
import {
  accounts,
  cardPaymentAllocations,
  debtInstallments,
  debts,
  postings,
  reviewItems,
  scheduledOccurrences,
  transactions,
  type CARD_PAYMENT_BUCKETS,
} from './schema.ts';

/** `@wf/domain/debt`'s buckets plus `credit`, the overpayment kept as the card's credit balance. */
export type CardPaymentBucket = (typeof CARD_PAYMENT_BUCKETS)[number];

/** One row of a schedule computed by `@wf/domain/debt`. */
export interface InstallmentInput {
  readonly dueDate: LocalDate;
  /** ≥ 0; the principals of a schedule add up to the principal it repays. */
  readonly principalMinor: bigint;
  /** ≥ 0. */
  readonly interestMinor: bigint;
  /** ≥ 0 (admin fee share). */
  readonly feeMinor: bigint;
}

/** "Tambah utang / cicilan" and "Ubah jadi cicilan" (FR-U1–U3). */
export interface DebtInput {
  readonly kind: DebtKind;
  /** 1–60 characters after trimming. */
  readonly name: string;
  /** "Penyedia", ≤ 40 characters after trimming; blank = none. */
  readonly provider?: string | null;
  /** `card_installment` only (required): an active credit card account. */
  readonly cardAccountId?: string | null;
  /**
   * `card_installment` only: the live, non-split expense on that card the plan is made from (its amount = the
   * principal); one plan per transaction.
   */
  readonly sourceTransactionId?: string | null;
  /** Other kinds only (required): the active account installments are paid from ("Bayar dari"). */
  readonly payFromAccountId?: string | null;
  /** Other kinds only: the non-income category of the installment expenses; `null` = uncategorized. */
  readonly categoryId?: string | null;
  /** > 0. */
  readonly principalMinor: bigint;
  /** The account currency. */
  readonly currency: string;
  readonly interestMethod: InterestMethod;
  /** Monthly interest in basis points, 0–10000 (150 = 1,5% per bulan). */
  readonly monthlyRateBps: number;
  /** ≥ 0. */
  readonly adminFeeMinor: bigint;
  /** 1–360. */
  readonly tenorMonths: number;
  readonly firstDueDate: LocalDate;
  /** `tenorMonths` rows, due dates strictly increasing from `firstDueDate`. */
  readonly schedule: readonly InstallmentInput[];
}

export interface InstallmentView {
  readonly id: string;
  /** 1-based position ("1/3"). */
  readonly seq: number;
  readonly dueDate: LocalDate;
  readonly principalMinor: bigint;
  readonly interestMinor: bigint;
  readonly feeMinor: bigint;
  /** Principal + interest + fee. */
  readonly totalMinor: bigint;
  readonly status: 'scheduled' | 'paid';
  readonly paidAt: Date | null;
  /** The expense that paid it (other kinds). */
  readonly transactionId: string | null;
  /** Card installments: on a card statement already (due date ≤ today); always `false` for other kinds. */
  readonly billed: boolean;
}

/** A card payment (transfer into the card) that paid part of a card installment early (FR-U4). */
export interface DebtAllocationView {
  readonly transactionId: string;
  readonly amountMinor: bigint;
  /** The transfer's date. */
  readonly localDate: LocalDate;
}

/** Every column of `debts` but `user_id`. */
export type DebtRow = Omit<typeof debts.$inferSelect, 'userId'>;

export interface DebtView extends DebtRow {
  /** By `seq`. */
  readonly installments: InstallmentView[];
  /** Σ card payments allocated to this installment ("dilunasi lebih awal"). */
  readonly paidEarlyMinor: bigint;
  /** Σ principal still owed: card → rows not yet billed; other kinds → rows not yet paid. */
  readonly remainingPrincipalMinor: bigint;
  /** Oldest first. */
  readonly allocations: DebtAllocationView[];
}

/** The Debts page (FR-U1 KPIs). */
export interface DebtList {
  /** The user's local date. */
  readonly today: LocalDate;
  /** Matching the status filter, oldest first. */
  readonly debts: DebtView[];
  /** "Sisa utang": Σ remaining principal of active debts, in the base currency. */
  readonly remainingMinor: bigint;
  /** "Harus dibayar": Σ totals of unpaid rows of active debts due this calendar month, in the base currency. */
  readonly dueThisMonthMinor: bigint;
  /** "Jatuh tempo terdekat": the earliest unpaid row due today or later (total in its debt currency). */
  readonly nextDue: { readonly debtId: string; readonly dueDate: LocalDate; readonly totalMinor: bigint } | null;
}

/** Editable fields; omitted ones are kept. */
export interface DebtPatch {
  readonly name?: string;
  readonly provider?: string | null;
  /** Other kinds only. */
  readonly categoryId?: string | null;
  /** Other kinds only; same currency as the debt. */
  readonly payFromAccountId?: string;
}

/** A credit card account with what FR-R7 shows about it (raw data; the page derives limits and bills). */
export interface CardView {
  readonly accountId: string;
  readonly name: string;
  readonly currency: string;
  readonly limitMinor: bigint | null;
  readonly statementDay: number | null;
  readonly dueDay: number | null;
  /** The account balance (negative = owed), as on the Accounts page. */
  readonly balanceMinor: bigint;
  /** "Cicilan ditahan di limit": Σ remaining principal of the card's active installments. */
  readonly installmentsHeldMinor: bigint;
}

/** One part of a card payment (FR-U4). */
export interface CardAllocationInput {
  readonly bucket: CardPaymentBucket;
  /** `installments` only (required): an active card installment of the paid card. */
  readonly debtId?: string | null;
  /** > 0. */
  readonly amountMinor: bigint;
}

/** The new schedule of a card installment after an early payoff (computed by `@wf/domain/debt`). */
export interface RecalculationInput {
  readonly debtId: string;
  /** `reduce_amount`: as many rows as the unbilled ones; `shorten_tenor`: at most as many. */
  readonly mode: RecalcMode;
  /** Rows due after today whose principals add up to the principal remaining after the payment. */
  readonly schedule: readonly InstallmentInput[];
}

export interface CardPaymentInput {
  /** A live transfer into a credit card account. */
  readonly transactionId: string;
  /** Σ ≤ the amount the card received; at most one part per bucket and debt. */
  readonly allocations: readonly CardAllocationInput[];
  /** Required for every installment left with a remaining principal; refused for one paid off in full. */
  readonly recalculations?: readonly RecalculationInput[];
}

/** "Bayar cicilan" outside the Review queue. */
export interface InstallmentPayment {
  /** Idempotency key: a replay returns the first transaction. */
  readonly clientId: string;
  readonly occurredAt: Date;
  /** Default: the debt's "Bayar dari" account. */
  readonly accountId?: string;
  /** Default: the row total. */
  readonly amountMinor?: bigint;
}

export interface DebtsRepository {
  /**
   * The Debts page: debts (default `active`) and the KPIs over all active debts.
   * @throws {LedgerError} `FX_RATE_MISSING` when an active debt's currency has no rate to the base currency.
   */
  list: (userId: string, options?: { readonly status?: 'active' | 'paid_off' | 'all' }) => Promise<DebtList>;
  /** @throws {LedgerError} `NOT_FOUND` */
  get: (userId: string, id: string) => Promise<DebtView>;
  /**
   * Stores a debt with its schedule; other kinds get their installment occurrences (FR-U6) right away.
   * @throws {LedgerError} `INVALID_DEBT`, `NOT_FOUND` / `INVALID_CATEGORY` / `CATEGORY_KIND_MISMATCH` (category)
   */
  create: (userId: string, input: DebtInput) => Promise<DebtView>;
  /** @throws {LedgerError} `NOT_FOUND`, `INVALID_DEBT`, and the category codes of {@link DebtsRepository.create} */
  update: (userId: string, id: string, patch: DebtPatch) => Promise<DebtView>;
  /**
   * Deletes the debt, its schedule, card payment allocations, and its occurrences not yet confirmed (with their
   * review items); recorded expenses stay.
   * @throws {LedgerError} `NOT_FOUND`
   */
  remove: (userId: string, id: string) => Promise<void>;
  /** Active credit card accounts (FR-R7), in account order. */
  cards: (userId: string) => Promise<CardView[]>;
  /**
   * Allocates a card payment (FR-U4) and applies early payoffs: a recalculation replaces the installment's unbilled
   * rows (seq continues after the billed ones) and records its mode; one paid off in full loses its unbilled rows and
   * becomes `paid_off`. Card installments have no occurrences, so nothing is pruned. Returns the paid installments.
   * @throws {LedgerError} `INVALID_DEBT`
   */
  allocateCardPayment: (userId: string, input: CardPaymentInput) => Promise<DebtView[]>;
  /**
   * Pays a non-card installment row with an expense (`Cicilan {name} ({seq}/{tenor})`, merchant = provider, the
   * debt category) and marks it paid; its occurrence is confirmed (and its review item resolved), and the debt
   * becomes `paid_off` once every row is paid.
   * @throws {LedgerError} `NOT_FOUND`, `INVALID_DEBT` (card installment, row already paid), and every code of
   * recording a transaction
   */
  payInstallment: (
    userId: string,
    installmentId: string,
    payment: InstallmentPayment,
  ) => Promise<{ transactionId: string }>;
}

const NAME_MAX = 60;
const PROVIDER_MAX = 40;
const TENOR_MAX = 360;
const RATE_MAX_BPS = 10_000;

const DEBT_COLUMNS = {
  id: debts.id,
  kind: debts.kind,
  name: debts.name,
  provider: debts.provider,
  cardAccountId: debts.cardAccountId,
  payFromAccountId: debts.payFromAccountId,
  sourceTransactionId: debts.sourceTransactionId,
  categoryId: debts.categoryId,
  principalMinor: debts.principalMinor,
  currency: debts.currency,
  interestMethod: debts.interestMethod,
  monthlyRateBps: debts.monthlyRateBps,
  adminFeeMinor: debts.adminFeeMinor,
  tenorMonths: debts.tenorMonths,
  firstDueDate: debts.firstDueDate,
  recalcMode: debts.recalcMode,
  recalculatedAt: debts.recalculatedAt,
  status: debts.status,
  paidOffAt: debts.paidOffAt,
  createdAt: debts.createdAt,
  updatedAt: debts.updatedAt,
};

function invalid(message: string): LedgerError {
  return new LedgerError('INVALID_DEBT', message);
}

const totalOf = (row: Pick<InstallmentInput, 'principalMinor' | 'interestMinor' | 'feeMinor'>) =>
  row.principalMinor + row.interestMinor + row.feeMinor;

/**
 * Checks a schedule: valid due dates strictly increasing and after `after`, amounts ≥ 0 with a positive total per
 * row, principals adding up to `principalMinor`.
 */
function checkSchedule(schedule: readonly InstallmentInput[], principalMinor: bigint, after: LocalDate | null): void {
  let previous = after;
  let principal = 0n;
  for (const row of schedule) {
    try {
      parseLocalDate(row.dueDate);
    } catch {
      throw invalid('Invalid due date');
    }
    if (previous !== null && row.dueDate <= previous) throw invalid('Due dates must increase');
    if (row.principalMinor < 0n || row.interestMinor < 0n || row.feeMinor < 0n || totalOf(row) === 0n) {
      throw invalid('Invalid installment amounts');
    }
    principal += row.principalMinor;
    previous = row.dueDate;
  }
  if (principal !== principalMinor) throw invalid('The installments do not add up to the principal');
}

/** The trimmed name. */
function checkName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > NAME_MAX) throw invalid('The name must be 1–60 characters');
  return trimmed;
}

/** The trimmed provider; blank = none. */
function checkProvider(provider: string | null | undefined): string | null {
  const trimmed = provider?.trim() ?? '';
  if (trimmed.length > PROVIDER_MAX) throw invalid('The provider must be at most 40 characters');
  return trimmed === '' ? null : trimmed;
}

/** Checks that `id` is an active account in `currency` (and a credit card when `card`). */
async function checkAccountIn(tx: Transaction, id: string, currency: string, card: boolean): Promise<void> {
  const [row] = await tx
    .select({ type: accounts.type, currency: accounts.currency, status: accounts.status })
    .from(accounts)
    .where(eq(accounts.id, id));
  if (row === undefined || row.status === 'archived') throw invalid('No such active account');
  if (card && row.type !== 'credit_card') throw invalid('A card installment needs a credit card account');
  if (row.currency !== currency) throw invalid('The debt currency must be the account currency');
}

/** Checks "Ubah jadi cicilan": a live, non-split expense of `principalMinor` on the card, not yet a plan. */
async function checkSourceTransactionIn(
  tx: Transaction,
  id: string,
  cardAccountId: string,
  principalMinor: bigint,
): Promise<void> {
  const [row] = await tx
    .select({ amountMinor: postings.amountMinor })
    .from(transactions)
    .innerJoin(
      postings,
      and(
        eq(postings.transactionId, transactions.id),
        eq(postings.role, 'principal'),
        eq(postings.accountId, cardAccountId),
      ),
    )
    .where(
      and(
        eq(transactions.id, id),
        eq(transactions.type, 'expense'),
        isNull(transactions.deletedAt),
        isNull(transactions.splitParentId),
      ),
    );
  if (row === undefined) throw invalid('The plan must come from a live, non-split expense on the card');
  if (-row.amountMinor !== principalMinor) throw invalid('The principal must be the expense amount');
  const [taken] = await tx.select({ id: debts.id }).from(debts).where(eq(debts.sourceTransactionId, id));
  if (taken !== undefined) throw invalid('The expense is already an installment plan');
}

/** The validated `debts` values of `input` (its schedule checked too). */
async function checkInputIn(tx: Transaction, input: DebtInput) {
  const card = input.kind === 'card_installment';
  const cardAccountId = input.cardAccountId ?? null;
  const payFromAccountId = input.payFromAccountId ?? null;
  const sourceTransactionId = input.sourceTransactionId ?? null;
  const categoryId = input.categoryId ?? null;
  if (card ? cardAccountId === null || payFromAccountId !== null || categoryId !== null : cardAccountId !== null) {
    throw invalid('A card installment has a card account and no payment account or category');
  }
  if (!card && (payFromAccountId === null || sourceTransactionId !== null)) {
    throw invalid('A debt is paid from an account and has no card transaction');
  }
  if (input.principalMinor <= 0n) throw invalid('The principal must be positive');
  if (!Number.isInteger(input.monthlyRateBps) || input.monthlyRateBps < 0 || input.monthlyRateBps > RATE_MAX_BPS) {
    throw invalid('Invalid interest rate');
  }
  if (input.adminFeeMinor < 0n) throw invalid('The admin fee must not be negative');
  if (!Number.isInteger(input.tenorMonths) || input.tenorMonths < 1 || input.tenorMonths > TENOR_MAX) {
    throw invalid('The tenor must be 1–360 months');
  }
  if (input.schedule.length !== input.tenorMonths) throw invalid('The schedule must have one row per month');
  if (input.schedule[0]?.dueDate !== input.firstDueDate) throw invalid('The schedule must start on the first due date');
  checkSchedule(input.schedule, input.principalMinor, null);
  const name = checkName(input.name);
  const provider = checkProvider(input.provider);
  await checkAccountIn(tx, (cardAccountId ?? payFromAccountId) as string, input.currency, card);
  if (sourceTransactionId !== null) {
    await checkSourceTransactionIn(tx, sourceTransactionId, cardAccountId as string, input.principalMinor);
  }
  if (categoryId !== null) await checkCategoryIn(tx, categoryId, 'expense');
  return {
    kind: input.kind,
    name,
    provider,
    cardAccountId,
    payFromAccountId,
    sourceTransactionId,
    categoryId,
    principalMinor: input.principalMinor,
    currency: input.currency,
    interestMethod: input.interestMethod,
    monthlyRateBps: input.monthlyRateBps,
    adminFeeMinor: input.adminFeeMinor,
    tenorMonths: input.tenorMonths,
    firstDueDate: input.firstDueDate,
  };
}

/** Inserts `schedule` as rows `firstSeq`, `firstSeq + 1`, … of the debt. */
async function insertScheduleIn(
  tx: Transaction,
  userId: string,
  debtId: string,
  firstSeq: number,
  schedule: readonly InstallmentInput[],
): Promise<void> {
  await tx.insert(debtInstallments).values(
    schedule.map((row, index) => ({
      userId,
      debtId,
      seq: firstSeq + index,
      dueDate: row.dueDate,
      principalMinor: row.principalMinor,
      interestMinor: row.interestMinor,
      feeMinor: row.feeMinor,
    })),
  );
}

/** Debts matching `where` with their schedules and allocations, oldest first. */
async function viewsIn(tx: Transaction, today: LocalDate, where?: SQL): Promise<DebtView[]> {
  const rows = await tx.select(DEBT_COLUMNS).from(debts).where(where).orderBy(asc(debts.createdAt), asc(debts.id));
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const installments = await tx
    .select()
    .from(debtInstallments)
    .where(inArray(debtInstallments.debtId, ids))
    .orderBy(asc(debtInstallments.seq));
  const allocations = await tx
    .select({
      debtId: cardPaymentAllocations.debtId,
      transactionId: cardPaymentAllocations.transactionId,
      amountMinor: cardPaymentAllocations.amountMinor,
      localDate: transactions.localDate,
    })
    .from(cardPaymentAllocations)
    .innerJoin(transactions, eq(transactions.id, cardPaymentAllocations.transactionId))
    .where(inArray(cardPaymentAllocations.debtId, ids))
    .orderBy(asc(transactions.localDate), asc(cardPaymentAllocations.createdAt), asc(cardPaymentAllocations.id));
  return rows.map((row): DebtView => {
    const card = row.kind === 'card_installment';
    const schedule = installments
      .filter((installment) => installment.debtId === row.id)
      .map((installment): InstallmentView => ({
        id: installment.id,
        seq: installment.seq,
        dueDate: installment.dueDate,
        principalMinor: installment.principalMinor,
        interestMinor: installment.interestMinor,
        feeMinor: installment.feeMinor,
        totalMinor: totalOf(installment),
        status: installment.status,
        paidAt: installment.paidAt,
        transactionId: installment.transactionId,
        billed: card && installment.dueDate <= today,
      }));
    const paid = allocations
      .filter((allocation) => allocation.debtId === row.id)
      .map(({ transactionId, amountMinor, localDate }) => ({ transactionId, amountMinor, localDate }));
    return {
      ...row,
      installments: schedule,
      paidEarlyMinor: paid.reduce((sum, allocation) => sum + allocation.amountMinor, 0n),
      remainingPrincipalMinor: schedule
        .filter((installment) => installment.status === 'scheduled' && !installment.billed)
        .reduce((sum, installment) => sum + installment.principalMinor, 0n),
      allocations: paid,
    };
  });
}

async function viewIn(tx: Transaction, today: LocalDate, id: string): Promise<DebtView> {
  const [view] = await viewsIn(tx, today, eq(debts.id, id));
  if (view === undefined) throw new LedgerError('NOT_FOUND', 'No such debt');
  return view;
}

async function lockedDebtIn(tx: Transaction, id: string) {
  const [row] = await tx.select().from(debts).where(eq(debts.id, id)).for('update');
  if (row === undefined) throw new LedgerError('NOT_FOUND', 'No such debt');
  return row;
}

/** The expense paying a non-card installment (FR-U6), without its date, source, and idempotency key. */
export interface InstallmentExpense {
  /** The debt's "Bayar dari" account. */
  readonly accountId: string;
  /** The row total. */
  readonly amountMinor: bigint;
  readonly categoryId: string | null;
  /** The provider. */
  readonly merchant: string | null;
  /** `Cicilan {name} ({seq}/{tenor})`. */
  readonly description: string;
}

/**
 * The expense paying the row of non-card debt `debtId` due on `dueDate` (shared by the Review proposal and
 * `payInstallment`). Read-only (works as `wf_worker`).
 * @throws {LedgerError} `NOT_FOUND` when there is no such row.
 */
export async function installmentExpenseIn(
  tx: Transaction,
  debtId: string,
  dueDate: LocalDate,
): Promise<InstallmentExpense> {
  const [row] = await tx
    .select({
      seq: debtInstallments.seq,
      principalMinor: debtInstallments.principalMinor,
      interestMinor: debtInstallments.interestMinor,
      feeMinor: debtInstallments.feeMinor,
      name: debts.name,
      provider: debts.provider,
      tenorMonths: debts.tenorMonths,
      accountId: debts.payFromAccountId,
      categoryId: debts.categoryId,
    })
    .from(debtInstallments)
    .innerJoin(debts, eq(debts.id, debtInstallments.debtId))
    .where(and(eq(debtInstallments.debtId, debtId), eq(debtInstallments.dueDate, dueDate)));
  if (row === undefined) throw new LedgerError('NOT_FOUND', 'No such installment');
  return {
    accountId: row.accountId as string,
    amountMinor: totalOf(row),
    categoryId: row.categoryId,
    merchant: row.provider,
    description: `Cicilan ${row.name} (${String(row.seq)}/${String(row.tenorMonths)})`,
  };
}

/**
 * Marks the unpaid row of `debtId` due on `dueDate` paid by `transactionId`, and the debt `paid_off` once no row is
 * left unpaid. Used by `payInstallment` and by confirming the row's review item (`review.confirm`).
 */
export async function markInstallmentPaidIn(
  tx: Transaction,
  debtId: string,
  dueDate: LocalDate,
  transactionId: string,
  at: Date,
): Promise<void> {
  await tx
    .update(debtInstallments)
    .set({ status: 'paid', paidAt: at, transactionId, updatedAt: at })
    .where(
      and(
        eq(debtInstallments.debtId, debtId),
        eq(debtInstallments.dueDate, dueDate),
        eq(debtInstallments.status, 'scheduled'),
      ),
    );
  await tx
    .update(debts)
    .set({ status: 'paid_off', paidOffAt: at, updatedAt: at })
    .where(
      and(
        eq(debts.id, debtId),
        eq(debts.status, 'active'),
        sql`not exists (select 1 from ${debtInstallments} where ${debtInstallments.debtId} = ${debts.id} and ${debtInstallments.status} = 'scheduled')`,
      ),
    );
}

/** The card account and amount received by a live transfer into a credit card. */
async function cardPaymentIn(tx: Transaction, transactionId: string) {
  const [leg] = await tx
    .select({ accountId: postings.accountId, amountMinor: postings.amountMinor })
    .from(postings)
    .innerJoin(transactions, eq(transactions.id, postings.transactionId))
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(
      and(
        eq(postings.transactionId, transactionId),
        eq(postings.role, 'principal'),
        sql`${postings.amountMinor} > 0`,
        eq(accounts.type, 'credit_card'),
        eq(transactions.type, 'transfer'),
        isNull(transactions.deletedAt),
      ),
    );
  if (leg === undefined) throw invalid('Only a transfer into a credit card can be allocated');
  return leg;
}

export function createDebts(db: Database, options: { readonly now?: () => Date } = {}): DebtsRepository {
  const now = options.now ?? (() => new Date());
  const todayIn = async (tx: Transaction, userId: string) => (await userClockIn(tx, userId, now())).today;

  return {
    list: (userId, { status = 'active' } = {}) =>
      withUser(db, userId, async (tx) => {
        const { baseCurrency, timezone } = await userContextIn(tx, userId);
        const today = localDateOf(now(), timezone);
        const all = await viewsIn(tx, today);
        const active = all.filter((debt) => debt.status === 'active');
        const valuation = await valuationIn(
          tx,
          baseCurrency,
          active.map((debt) => debt.currency),
        );
        const month = today.slice(0, 7);
        let remainingMinor = 0n;
        let dueThisMonthMinor = 0n;
        let nextDue: DebtList['nextDue'] = null;
        for (const debt of active) {
          remainingMinor += toBase({ minor: debt.remainingPrincipalMinor, currency: debt.currency }, valuation);
          for (const row of debt.installments) {
            if (row.status === 'paid') continue;
            if (row.dueDate.startsWith(month)) {
              dueThisMonthMinor += toBase({ minor: row.totalMinor, currency: debt.currency }, valuation);
            }
            if (row.dueDate >= today && (nextDue === null || row.dueDate < nextDue.dueDate)) {
              nextDue = { debtId: debt.id, dueDate: row.dueDate, totalMinor: row.totalMinor };
            }
          }
        }
        return {
          today,
          debts: status === 'all' ? all : all.filter((debt) => debt.status === status),
          remainingMinor,
          dueThisMonthMinor,
          nextDue,
        };
      }),

    get: (userId, id) => withUser(db, userId, async (tx) => viewIn(tx, await todayIn(tx, userId), id)),

    create: (userId, input) =>
      withUser(db, userId, async (tx) => {
        const values = await checkInputIn(tx, input);
        const { id } = firstRow(
          await tx
            .insert(debts)
            .values({ userId, ...values })
            .returning({ id: debts.id }),
          'debts',
        );
        await insertScheduleIn(tx, userId, id, 1, input.schedule);
        // Card installments have no occurrences: nothing is materialized for them.
        await materializeIn(tx, userId, { now: now(), source: { type: 'installment', id } });
        return viewIn(tx, await todayIn(tx, userId), id);
      }),

    update: (userId, id, patch) =>
      withUser(db, userId, async (tx) => {
        const row = await lockedDebtIn(tx, id);
        const card = row.kind === 'card_installment';
        if (card && (patch.payFromAccountId !== undefined || (patch.categoryId ?? null) !== null)) {
          throw invalid('A card installment has no payment account or category');
        }
        const values: Partial<typeof debts.$inferInsert> = { updatedAt: now() };
        if (patch.name !== undefined) values.name = checkName(patch.name);
        if (patch.provider !== undefined) values.provider = checkProvider(patch.provider);
        if (patch.payFromAccountId !== undefined) {
          await checkAccountIn(tx, patch.payFromAccountId, row.currency, false);
          values.payFromAccountId = patch.payFromAccountId;
        }
        if (patch.categoryId !== undefined) {
          if (patch.categoryId !== null) await checkCategoryIn(tx, patch.categoryId, 'expense');
          values.categoryId = patch.categoryId;
        }
        await tx.update(debts).set(values).where(eq(debts.id, id));
        return viewIn(tx, await todayIn(tx, userId), id);
      }),

    remove: (userId, id) =>
      withUser(db, userId, async (tx) => {
        await lockedDebtIn(tx, id);
        await tx
          .delete(scheduledOccurrences)
          .where(
            and(
              eq(scheduledOccurrences.sourceType, 'installment'),
              eq(scheduledOccurrences.sourceId, id),
              ne(scheduledOccurrences.status, 'confirmed'),
            ),
          );
        await tx.delete(debts).where(eq(debts.id, id));
      }),

    cards: (userId) =>
      withUser(db, userId, async (tx) => {
        const { views } = await accountViewsIn(
          tx,
          userId,
          and(eq(accounts.type, 'credit_card'), eq(accounts.status, 'active')),
        );
        const held = await viewsIn(
          tx,
          await todayIn(tx, userId),
          and(eq(debts.kind, 'card_installment'), eq(debts.status, 'active')),
        );
        return views.map((view) => ({
          accountId: view.id,
          name: view.displayName,
          currency: view.currency,
          limitMinor: view.ccLimitMinor,
          statementDay: view.ccStatementDay,
          dueDay: view.ccDueDay,
          balanceMinor: view.balanceMinor,
          installmentsHeldMinor: held
            .filter((debt) => debt.cardAccountId === view.id)
            .reduce((sum, debt) => sum + debt.remainingPrincipalMinor, 0n),
        }));
      }),

    allocateCardPayment: (userId, input) =>
      withUser(db, userId, async (tx) => {
        const at = now();
        const today = await todayIn(tx, userId);
        const payment = await cardPaymentIn(tx, input.transactionId);
        const [allocated] = await tx
          .select({ id: cardPaymentAllocations.id })
          .from(cardPaymentAllocations)
          .where(eq(cardPaymentAllocations.transactionId, input.transactionId));
        if (allocated !== undefined) throw invalid('The payment is already allocated');
        const keys = new Set<string>();
        let total = 0n;
        for (const part of input.allocations) {
          const debtId = part.debtId ?? null;
          if ((part.bucket === 'installments') !== (debtId !== null)) {
            throw invalid('Only an installments part names an installment');
          }
          if (part.amountMinor <= 0n) throw invalid('Allocated amounts must be positive');
          const key = `${part.bucket}.${debtId ?? ''}`;
          if (keys.has(key)) throw invalid('One part per bucket and installment');
          keys.add(key);
          total += part.amountMinor;
        }
        if (total > payment.amountMinor) throw invalid('The allocations exceed the payment');
        const recalculations = new Map<string, RecalculationInput>();
        for (const recalculation of input.recalculations ?? []) {
          if (!keys.has(`installments.${recalculation.debtId}`) || recalculations.has(recalculation.debtId)) {
            throw invalid('A recalculation needs one installments part of its own');
          }
          recalculations.set(recalculation.debtId, recalculation);
        }

        const paid: string[] = [];
        for (const part of input.allocations) {
          if (part.bucket !== 'installments') continue;
          const debtId = part.debtId as string;
          const [debt] = await tx
            .select({ id: debts.id })
            .from(debts)
            .where(
              and(
                eq(debts.id, debtId),
                eq(debts.kind, 'card_installment'),
                eq(debts.cardAccountId, payment.accountId),
                eq(debts.status, 'active'),
              ),
            )
            .for('update');
          if (debt === undefined) throw invalid('No such active installment on this card');
          const rows = await tx
            .select({
              id: debtInstallments.id,
              seq: debtInstallments.seq,
              dueDate: debtInstallments.dueDate,
              principalMinor: debtInstallments.principalMinor,
            })
            .from(debtInstallments)
            .where(eq(debtInstallments.debtId, debtId))
            .orderBy(asc(debtInstallments.seq));
          // Card rows are never `paid`: those due after today are the ones not billed yet.
          const unbilled = rows.filter((row) => row.dueDate > today);
          const remaining = unbilled.reduce((sum, row) => sum + row.principalMinor, 0n);
          if (part.amountMinor > remaining) throw invalid('The allocation exceeds the remaining principal');
          const left = remaining - part.amountMinor;
          const recalculation = recalculations.get(debtId);
          const values: Partial<typeof debts.$inferInsert> = { updatedAt: at };
          if (left === 0n) {
            if (recalculation !== undefined) throw invalid('A paid-off installment has nothing to recalculate');
            values.status = 'paid_off';
            values.paidOffAt = at;
          } else {
            if (recalculation === undefined) throw invalid('A partial payoff needs a recalculation');
            const count = recalculation.schedule.length;
            if (
              recalculation.mode === 'reduce_amount'
                ? count !== unbilled.length
                : count === 0 || count > unbilled.length
            ) {
              throw invalid('The recalculated schedule does not fit its mode');
            }
            checkSchedule(recalculation.schedule, left, today);
            values.recalcMode = recalculation.mode;
            values.recalculatedAt = at;
            values.tenorMonths = rows.length - unbilled.length + count;
          }
          await tx.delete(debtInstallments).where(
            inArray(
              debtInstallments.id,
              unbilled.map((row) => row.id),
            ),
          );
          if (recalculation !== undefined) {
            await insertScheduleIn(tx, userId, debtId, rows.length - unbilled.length + 1, recalculation.schedule);
          }
          await tx.update(debts).set(values).where(eq(debts.id, debtId));
          paid.push(debtId);
        }
        await tx.insert(cardPaymentAllocations).values(
          input.allocations.map((part) => ({
            userId,
            transactionId: input.transactionId,
            bucket: part.bucket,
            debtId: part.debtId ?? null,
            amountMinor: part.amountMinor,
          })),
        );
        return paid.length === 0 ? [] : viewsIn(tx, today, inArray(debts.id, paid));
      }),

    payInstallment: (userId, installmentId, payment) =>
      withUser(db, userId, async (tx) => {
        const at = now();
        const [row] = await tx
          .select({
            debtId: debtInstallments.debtId,
            dueDate: debtInstallments.dueDate,
            status: debtInstallments.status,
            transactionId: debtInstallments.transactionId,
            kind: debts.kind,
          })
          .from(debtInstallments)
          .innerJoin(debts, eq(debts.id, debtInstallments.debtId))
          .where(eq(debtInstallments.id, installmentId))
          .for('update');
        if (row === undefined) throw new LedgerError('NOT_FOUND', 'No such installment');
        if (row.kind === 'card_installment') throw invalid('Card installments are paid with the card bill');
        if (row.status === 'paid') {
          const [replay] = await tx
            .select({ id: transactions.id })
            .from(transactions)
            .where(and(eq(transactions.clientId, payment.clientId), eq(transactions.id, row.transactionId as string)));
          if (replay === undefined) throw invalid('The installment is already paid');
          return { transactionId: replay.id };
        }
        const expense = await installmentExpenseIn(tx, row.debtId, row.dueDate);
        const { id } = await recordTransactionIn(
          tx,
          userId,
          {
            ...expense,
            type: 'expense',
            clientId: payment.clientId,
            occurredAt: payment.occurredAt,
            accountId: payment.accountId ?? expense.accountId,
            amountMinor: payment.amountMinor ?? expense.amountMinor,
          },
          null,
          at,
        );
        await markInstallmentPaidIn(tx, row.debtId, row.dueDate, id, at);
        // Its occurrence (if materialized) is paid now: confirm it and resolve a pending review item.
        await tx
          .update(scheduledOccurrences)
          .set({ status: 'confirmed', transactionId: id, updatedAt: at })
          .where(
            and(
              eq(scheduledOccurrences.sourceType, 'installment'),
              eq(scheduledOccurrences.sourceId, row.debtId),
              eq(scheduledOccurrences.dueDate, row.dueDate),
              ne(scheduledOccurrences.status, 'confirmed'),
            ),
          );
        await tx
          .update(reviewItems)
          .set({ status: 'confirmed', resolvedAt: at, resultingTransactionId: id, updatedAt: at })
          .where(
            and(
              eq(reviewItems.status, 'pending'),
              inArray(
                reviewItems.occurrenceId,
                tx
                  .select({ id: scheduledOccurrences.id })
                  .from(scheduledOccurrences)
                  .where(eq(scheduledOccurrences.transactionId, id)),
              ),
            ),
          );
        return { transactionId: id };
      }),
  };
}
