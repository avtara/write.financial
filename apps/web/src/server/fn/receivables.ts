// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Server functions of the Receivables tab and split bills (PRD §6.13 FR-U7, §6.4 FR-L5): "Catat piutang" (a loan, a
 * `receivable_out` transfer, not an expense), "Terima pembayaran" (a `receivable_in` transfer, not income), "Hapuskan"
 * (the open remainder becomes a "Piutang tak tertagih" expense), and "Pisah tagihan" in the Record sheet: the user's
 * part as an expense and the other people's parts as receivables, with the context its preview needs (people, the
 * receivables total, the month's spending, and the budget). The tab's list comes with `getDebtsOverview`. The user
 * always comes from the session; every write is idempotent per client id.
 */
import { createServerFn } from '@tanstack/react-start';
import { localDateOf } from '@wf/db/ledger-core';
import type { ReceivableView } from '@wf/db/receivables';
import { safeDailyStepMinor } from '@wf/domain/budget';
import { dateInMonth, type LocalDate, type YearMonth } from '@wf/domain/period';
import { MAX_COUNTERPARTY_LENGTH } from '@wf/domain/receivables';
import * as z from 'zod';
import { attempt, requireSession, type Result } from '../access.ts';
import { defined, localDate } from '../inputs.ts';
import type { RequestContext } from '../request-middleware.ts';
import { services, type Services } from '../runtime.ts';
import { RECORD_TRANSACTION_INPUT } from './transactions-write.ts';

/** The budget of the current period as the split-bill preview needs it ("Hiburan Oktober", "Batas aman harian"). */
export interface SplitBillBudget {
  readonly start: LocalDate;
  readonly end: LocalDate;
  /** The month the period is named after. */
  readonly label: YearMonth;
  /** Σ limits − Σ spent of the budget lines, and the days left: the safe daily limit's inputs. */
  readonly remainingMinor: bigint;
  readonly daysLeft: number;
  readonly stepMinor: bigint;
  readonly lines: readonly { readonly categoryId: string; readonly spentMinor: bigint }[];
}

/** What the Record sheet's "Pisah tagihan" shows before saving. */
export interface SplitBillContext {
  readonly today: LocalDate;
  /** People the user lent to before, most recent first ("Tambah orang" suggestions). */
  readonly people: string[];
  /** Σ open receivables, in the base currency. */
  readonly receivablesMinor: bigint;
  /** Spending of the current calendar month ("Pengeluaran Oktober"), in the base currency. */
  readonly month: { readonly label: YearMonth; readonly expenseMinor: bigint };
  /** `null` without a budget in force. */
  readonly budget: SplitBillBudget | null;
  /** `HH:mm` of the user's reminders ("Ingatkan aku H-1 jam 09.00"). */
  readonly reminderTime: string;
}

const id = z.uuid();
const counterparty = z.string().trim().min(1).max(MAX_COUNTERPARTY_LENGTH);
const [EXPENSE_INPUT] = RECORD_TRANSACTION_INPUT.options;
/** Most people a bill is split with. */
const MAX_SHARES = 20;

/** Runs `action` for the session user. */
function forUser<T>(
  context: Pick<RequestContext, 'session'>,
  action: (userId: string, services: Services, timezone: string) => Promise<T>,
): Promise<Result<T>> {
  return services().then((all) =>
    attempt(async () => {
      const { user } = await requireSession(context.session, {}, all.now());
      return action(user.id, all, user.timezone ?? 'Asia/Jakarta');
    }),
  );
}

/** FR-L5: the preview context of "Pisah tagihan". */
export const getSplitBillContext = createServerFn({ method: 'GET' }).handler(
  ({ context }): Promise<Result<SplitBillContext>> =>
    forUser(context, async (userId, all, timezone) => {
      const today = localDateOf(all.now(), timezone);
      const label = today.slice(0, 7) as YearMonth;
      const [receivables, summary, budget, notifications] = await Promise.all([
        all.receivables.list(userId),
        all.transactionQuery.summary(userId, { from: dateInMonth(label, 1), to: dateInMonth(label, 31) }),
        all.budgets.status(userId),
        all.notificationSettings.get(userId),
      ]);
      return {
        today,
        people: receivables.people,
        receivablesMinor: receivables.outstandingMinor,
        month: { label, expenseMinor: summary.outMinor },
        budget:
          budget.version === null
            ? null
            : {
                start: budget.period.start,
                end: budget.period.end,
                label: budget.period.label,
                remainingMinor: budget.totals.limitMinor - budget.totals.spentMinor,
                daysLeft: budget.totals.daysLeft,
                stepMinor: safeDailyStepMinor(budget.baseCurrency),
                lines: budget.lines.map(({ categoryId, spentMinor }) => ({ categoryId, spentMinor })),
              },
        reminderTime: notifications.reminderTime,
      };
    }),
);

/** FR-U7 "Catat piutang": money lent in cash or paid for someone (a loan); idempotent per `clientId`. */
export const recordReceivable = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      clientId: id,
      counterparty,
      amountMinor: z.bigint().positive(),
      fromAccountId: id,
      lentAt: z.date(),
      dueDate: localDate.nullable(),
      remind: z.boolean(),
      note: z.string().trim().max(500).nullable().optional(),
    }),
  )
  .handler(({ context, data }): Promise<Result<ReceivableView>> =>
    forUser(context, async (userId, all) => {
      const { receivable } = await all.receivables.record(userId, { ...defined(data), source: 'loan' });
      return receivable;
    }),
  );

/** FR-U7 "Terima pembayaran": all or part of what is left comes back into an account; idempotent per `clientId`. */
export const receiveReceivablePayment = createServerFn({ method: 'POST' })
  .validator(z.object({ id, clientId: id, amountMinor: z.bigint().positive(), accountId: id, receivedAt: z.date() }))
  .handler(({ context, data }): Promise<Result<ReceivableView>> =>
    forUser(context, (userId, all) => {
      const { id: receivableId, ...payment } = data;
      return all.receivables.receivePayment(userId, receivableId, payment);
    }),
  );

/** FR-U7 "Hapuskan" (after confirmation): the open remainder becomes a "Piutang tak tertagih" expense. */
export const writeOffReceivable = createServerFn({ method: 'POST' })
  .validator(z.object({ id, clientId: id, occurredAt: z.date() }))
  .handler(({ context, data }): Promise<Result<ReceivableView>> =>
    forUser(context, (userId, all) => {
      const { id: receivableId, ...writeOff } = data;
      return all.receivables.writeOff(userId, receivableId, writeOff);
    }),
  );

/**
 * FR-L5 "Simpan pembagian": `transaction` is the user's own part (an expense on the account that paid the whole bill),
 * `shares` the other people's parts, recorded as receivables with their due dates. Idempotent per client ids.
 */
export const recordSplitBill = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      transaction: EXPENSE_INPUT.extend({ type: z.literal('expense') }),
      shares: z
        .array(
          z.object({
            clientId: id,
            counterparty,
            amountMinor: z.bigint().positive(),
            dueDate: localDate.nullable(),
            remind: z.boolean(),
          }),
        )
        .min(1)
        .max(MAX_SHARES),
    }),
  )
  .handler(({ context, data }): Promise<Result<{ transactionId: string; receivables: ReceivableView[] }>> =>
    forUser(context, (userId, all) =>
      all.receivables.recordSplitBill(userId, { draft: defined(data.transaction), shares: data.shares }),
    ),
  );
