// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Server functions of "Utang & cicilan" (PRD §6.13 FR-R7, FR-U1–U6): the page data (debts, credit cards with their
 * current bill, the payment priority, the receivables list, and the month used by the impact simulation), adding a
 * debt, turning a card expense into an installment plan (afterwards or while recording it), recording a payment to a
 * card with its allocation and recalculation, and the payment priority. Schedules and allocations are computed here
 * from `@wf/domain` (never taken from the browser); the repositories check their invariants. The user always comes
 * from the session.
 */
import { createServerFn } from '@tanstack/react-start';
import type { AccountsOverview } from '@wf/db/accounts';
import type { CardView, DebtView } from '@wf/db/debts';
import type { ReceivablesOverview } from '@wf/db/receivables';
import { localDateOf } from '@wf/db/ledger-core';
import { LedgerError } from '@wf/db/ledger-errors';
import type { TransactionRow } from '@wf/db/transaction-query';
import { INSTALLMENT_TENORS, installmentIneligibility } from '@wf/domain/creditcard';
import {
  CC_PAYMENT_BUCKETS,
  DEFAULT_INTEREST_METHOD,
  installmentSchedule,
  RECALC_MODES,
  type CcPaymentBucket,
} from '@wf/domain/debt';
import { dateInMonth, type LocalDate, type YearMonth } from '@wf/domain/period';
import * as z from 'zod';
import {
  cardInstallmentSchedule,
  cardPaymentPlan,
  cardState,
  paymentPriority,
  toInstallmentInputs,
  type CardInstallmentTerms,
} from '../../lib/debts.ts';
import { attempt, requireSession, type Result } from '../access.ts';
import { defined, localDate } from '../inputs.ts';
import type { RequestContext } from '../request-middleware.ts';
import { services, type Services } from '../runtime.ts';
import { RECORD_TRANSACTION_INPUT } from './transactions-write.ts';

/** A credit card with the transactions of its current cycle that are not installment plans ("TRANSAKSI DI TAGIHAN INI"). */
export interface CardBill extends CardView {
  readonly transactions: TransactionRow[];
}

/** A debt with the date of the card expense it was made from ("dari transaksi 2 Nov"). */
export interface DebtItem extends DebtView {
  readonly sourceDate: LocalDate | null;
}

export interface DebtsOverview {
  /** The user's local date. */
  readonly today: LocalDate;
  readonly accounts: AccountsOverview;
  /** Active debts, oldest first. */
  readonly debts: DebtItem[];
  readonly cards: CardBill[];
  readonly priority: CcPaymentBucket[];
  /** The Receivables tab (FR-U7): active ones, the 90-day history, Σ outstanding ("Piutang"), and the people. */
  readonly receivables: ReceivablesOverview;
  /** `HH:mm` of the user's reminders ("pengingat H-1 jam 09.00"). */
  readonly reminderTime: string;
  /** The user's IANA time zone (dates typed in the receivable dialogs). */
  readonly timeZone: string;
  /** Income and spending of the current calendar month ("pola Oktober", FR-U5), in the base currency. */
  readonly month: { readonly incomeMinor: bigint; readonly expenseMinor: bigint };
}

/** What the Record sheet needs about the card it records on or pays into. */
export interface CardPaymentContext {
  readonly today: LocalDate;
  readonly card: CardView;
  /** Active installments of the card, oldest first. */
  readonly debts: DebtView[];
  readonly priority: CcPaymentBucket[];
}

const id = z.uuid();
const rateBps = z.int().min(0).max(10_000);
const fee = z.bigint().nonnegative();
const tenor = z.literal(INSTALLMENT_TENORS);
const [EXPENSE_INPUT, TRANSFER_INPUT] = RECORD_TRANSACTION_INPUT.options;
const priority = z
  .array(z.enum(CC_PAYMENT_BUCKETS))
  .length(CC_PAYMENT_BUCKETS.length)
  .refine((order) => new Set(order).size === order.length, 'each bucket once');

/** Runs `action` for the session user with their local date. */
function forUser<T>(
  context: Pick<RequestContext, 'session'>,
  action: (userId: string, services: Services, today: LocalDate, timezone: string) => Promise<T>,
): Promise<Result<T>> {
  return services().then((all) =>
    attempt(async () => {
      const { user } = await requireSession(context.session, {}, all.now());
      const timezone = user.timezone ?? 'Asia/Jakarta';
      return action(user.id, all, localDateOf(all.now(), timezone), timezone);
    }),
  );
}

/** A card whose cycle is known, so its expenses can be split. */
type SplittableCard = CardView & { readonly statementDay: number; readonly dueDay: number };

/** The user's active card `accountId` with its statement and due day. @throws {LedgerError} `INVALID_DEBT` */
async function cardOf(all: Services, userId: string, accountId: string): Promise<SplittableCard> {
  const card = (await all.debts.cards(userId)).find((candidate) => candidate.accountId === accountId);
  if (card?.statementDay == null || card.dueDay == null) {
    throw new LedgerError('INVALID_DEBT', 'Not an active credit card with statement and due days');
  }
  return { ...card, statementDay: card.statementDay, dueDay: card.dueDay };
}

/** The card plan of an expense of `amountMinor` on `date` (FR-U2); refuses one that cannot be split. */
function cardPlan(
  card: SplittableCard,
  expense: { readonly amountMinor: bigint; readonly localDate: LocalDate; readonly name: string },
  terms: CardInstallmentTerms,
  today: LocalDate,
) {
  const reason = installmentIneligibility(
    { accountType: 'credit_card', type: 'expense', amountMinor: expense.amountMinor, localDate: expense.localDate },
    card,
    today,
  );
  if (reason !== null) throw new LedgerError('INVALID_DEBT', `The expense cannot be split: ${reason}`);
  const schedule = cardInstallmentSchedule(card, expense.amountMinor, expense.localDate, terms);
  return {
    kind: 'card_installment' as const,
    name: expense.name.slice(0, 60),
    provider: card.name,
    cardAccountId: card.accountId,
    principalMinor: expense.amountMinor,
    currency: card.currency,
    interestMethod: 'flat' as const,
    monthlyRateBps: terms.monthlyRateBps,
    adminFeeMinor: terms.adminFeeMinor,
    tenorMonths: terms.tenor,
    firstDueDate: schedule[0]?.dueOn as LocalDate,
    schedule: toInstallmentInputs(schedule),
  };
}

/** FR-U1, FR-R7: everything the Debts page shows. */
export const getDebtsOverview = createServerFn({ method: 'GET' }).handler(
  ({ context }): Promise<Result<DebtsOverview>> =>
    forUser(context, async (userId, all, _today, timeZone) => {
      const [list, cards, accounts, preferences, receivables, notifications] = await Promise.all([
        all.debts.list(userId),
        all.debts.cards(userId),
        all.accounts.list(userId),
        all.preferences.get(userId),
        all.receivables.list(userId),
        all.notificationSettings.get(userId),
      ]);
      const month = list.today.slice(0, 7) as YearMonth;
      const planned = new Set(list.debts.map((debt) => debt.sourceTransactionId));
      const [summary, ...bills] = await Promise.all([
        all.transactionQuery.summary(userId, { from: dateInMonth(month, 1), to: dateInMonth(month, 31) }),
        ...cards.map(async (card): Promise<CardBill> => {
          const { cycle } = cardState(card, list.debts, list.today);
          if (cycle === null) return { ...card, transactions: [] };
          const page = await all.transactionQuery.list(
            userId,
            { accountIds: [card.accountId], types: ['expense', 'income'], from: cycle.start, to: cycle.statementOn },
            { sort: 'date_asc', limit: 200 },
          );
          return { ...card, transactions: page.rows.filter((row) => !planned.has(row.id)) };
        }),
      ]);
      return {
        today: list.today,
        accounts,
        debts: await Promise.all(
          list.debts.map(async (debt): Promise<DebtItem> => ({
            ...debt,
            sourceDate:
              debt.sourceTransactionId === null
                ? null
                : (await all.transactions.get(userId, debt.sourceTransactionId)).localDate,
          })),
        ),
        cards: bills,
        priority: paymentPriority(preferences.ccPaymentPriority),
        receivables,
        reminderTime: notifications.reminderTime,
        timeZone,
        month: { incomeMinor: summary.inMinor, expenseMinor: summary.outMinor },
      };
    }),
);

/** The card `accountId` as the Record sheet shows it (sisa limit, allocation preview). */
export const getCardPaymentContext = createServerFn({ method: 'GET' })
  .validator(z.object({ accountId: id }))
  .handler(({ context, data }): Promise<Result<CardPaymentContext>> =>
    forUser(context, async (userId, all) => {
      const [list, cards, preferences] = await Promise.all([
        all.debts.list(userId),
        all.debts.cards(userId),
        all.preferences.get(userId),
      ]);
      const card = cards.find((candidate) => candidate.accountId === data.accountId);
      if (card === undefined) throw new LedgerError('NOT_FOUND', 'No such active credit card');
      return {
        today: list.today,
        card,
        debts: list.debts.filter((debt) => debt.cardAccountId === card.accountId),
        priority: paymentPriority(preferences.ccPaymentPriority),
      };
    }),
  );

/** FR-U1/U3/U5 "Tambah utang / cicilan" (paylater, 0%, KPR/KPM, pinjaman): the schedule follows the kind's method. */
export const createDebt = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      kind: z.enum(['paylater', 'zero_percent', 'mortgage', 'personal_loan']),
      name: z.string().trim().min(1).max(60),
      provider: z.string().trim().max(40).nullable().optional(),
      principalMinor: z.bigint().positive(),
      tenorMonths: z.int().min(1).max(360),
      monthlyRateBps: rateBps,
      adminFeeMinor: fee,
      firstDueDate: localDate,
      payFromAccountId: id,
      categoryId: id.nullable().optional(),
    }),
  )
  .handler(({ context, data }): Promise<Result<DebtView>> =>
    forUser(context, async (userId, all) => {
      const account = await all.accounts.get(userId, data.payFromAccountId);
      const interestMethod = DEFAULT_INTEREST_METHOD[data.kind];
      const schedule = installmentSchedule({
        principalMinor: data.principalMinor,
        tenor: data.tenorMonths,
        monthlyRateBps: data.monthlyRateBps,
        adminFeeMinor: data.adminFeeMinor,
        method: interestMethod,
        firstDue: data.firstDueDate,
      });
      return all.debts.create(userId, {
        ...defined(data),
        currency: account.currency,
        interestMethod,
        schedule: toInstallmentInputs(schedule),
      });
    }),
  );

/** FR-U2 "Ubah jadi cicilan" (OEZIG): an expense already recorded on a card becomes an installment plan. */
export const convertCardTransaction = createServerFn({ method: 'POST' })
  .validator(z.object({ transactionId: id, tenor, monthlyRateBps: rateBps, adminFeeMinor: fee }))
  .handler(({ context, data }): Promise<Result<DebtView>> =>
    forUser(context, async (userId, all, today) => {
      const expense = await all.transactions.get(userId, data.transactionId);
      const principal = expense.postings.find((posting) => posting.role === 'principal');
      if (expense.type !== 'expense' || expense.deletedAt !== null || principal === undefined) {
        throw new LedgerError('INVALID_DEBT', 'Only a recorded expense can be split');
      }
      const card = await cardOf(all, userId, principal.accountId);
      const plan = cardPlan(
        card,
        {
          amountMinor: -principal.amountMinor,
          localDate: expense.localDate,
          name: expense.description ?? expense.merchant ?? card.name,
        },
        { tenor: data.tenor, monthlyRateBps: data.monthlyRateBps, adminFeeMinor: data.adminFeeMinor },
        today,
      );
      return all.debts.create(userId, { ...plan, sourceTransactionId: expense.id });
    }),
  );

/** FR-U2 "Pecah jadi cicilan" (hNvip): records the card expense as an installment plan; idempotent per `clientId`. */
export const recordCardInstallment = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      transaction: EXPENSE_INPUT.extend({ type: z.literal('expense') }),
      tenor,
      monthlyRateBps: rateBps,
      adminFeeMinor: fee,
    }),
  )
  .handler(({ context, data }): Promise<Result<{ transactionId: string; debt: DebtView }>> =>
    forUser(context, async (userId, all, today, timezone) => {
      const { transaction, ...terms } = data;
      const card = await cardOf(all, userId, transaction.accountId);
      const plan = cardPlan(
        card,
        {
          amountMinor: transaction.amountMinor,
          localDate: localDateOf(transaction.occurredAt, timezone),
          name: transaction.description ?? transaction.merchant ?? card.name,
        },
        terms,
        today,
      );
      return all.debts.recordInstallmentPurchase(userId, { draft: defined(transaction), plan });
    }),
  );

/**
 * FR-U4 (qrRRV): records a transfer into a card and allocates it by `priority`; an installment paid partly is
 * recalculated with `mode`. Idempotent per `clientId`.
 */
export const recordCardPayment = createServerFn({ method: 'POST' })
  .validator(z.object({ transaction: TRANSFER_INPUT, priority: priority.optional(), mode: z.enum(RECALC_MODES) }))
  .handler(({ context, data }): Promise<Result<{ transactionId: string; debts: DebtView[] }>> =>
    forUser(context, async (userId, all) => {
      const card = await cardOf(all, userId, data.transaction.toAccountId);
      const list = await all.debts.list(userId);
      const plan = cardPaymentPlan({
        state: cardState(card, list.debts, list.today),
        debts: list.debts,
        amountMinor: data.transaction.receivedMinor,
        priority: data.priority ?? paymentPriority((await all.preferences.get(userId)).ccPaymentPriority),
        mode: data.mode,
      });
      return all.debts.recordCardPayment(userId, {
        draft: defined(data.transaction),
        allocations: plan.parts,
        recalculations: plan.recalculations,
      });
    }),
  );

/** FR-U4 "Prioritas pembayaran kartu · Ubah": the order of installments and spending; returns it. */
export const setCardPaymentPriority = createServerFn({ method: 'POST' })
  .validator(z.object({ priority }))
  .handler(({ context, data }): Promise<Result<CcPaymentBucket[]>> =>
    forUser(context, async (userId, all) =>
      paymentPriority((await all.preferences.update(userId, { ccPaymentPriority: data.priority })).ccPaymentPriority),
    ),
  );
