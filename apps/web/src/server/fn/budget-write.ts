// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Write server functions of the budget page and Settings › Periode bulanan: budget versions and lines (FR-B1/B2),
 * per-category options (FR-B4), moving leftover with Undo (FR-B3), dismissed warnings (FR-B5), and the period start
 * day (FR-P2) with its preview next to it. The user always comes from the session; the repositories refuse every
 * write that would reach a closed period (FR-P3, `PERIOD_CLOSED`).
 */
import { createServerFn } from '@tanstack/react-start';
import type { BudgetVersionView } from '@wf/db/budgets';
import type { StartDayPreview } from '@wf/db/periods';
import { ALERT_PCTS, type LimitDelta } from '@wf/domain/budget';
import type { YearMonth } from '@wf/domain/period';
import * as z from 'zod';
import { attempt, requireSession, type Result } from '../access.ts';
import { services } from '../runtime.ts';

const id = z.uuid();
const limitMinor = z.bigint().nonnegative();
const alertPct = z.literal(ALERT_PCTS);
const yearMonth = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .transform((value) => value as YearMonth);
/** More lines than any budget has; keeps a request bounded. */
const MAX_LINES = 200;

/** The input of a start-day change (FR-P1/P2). */
const startDayChange = z.object({
  day: z.number().int().min(1).max(28),
  apply: z.enum(['next_period', 'recalculate']),
  mode: z.enum(['fixed_day', 'follow_payday']).optional(),
});

/** Drops an absent `mode`, which the repository's exact optional type does not accept as `undefined`. */
function toStartDayChange(data: z.infer<typeof startDayChange>) {
  return { day: data.day, apply: data.apply, ...(data.mode === undefined ? {} : { mode: data.mode }) };
}

/** FR-B1 "Atur anggaran · Simpan anggaran": the lines of the version effective from a period label. */
export const saveBudgetVersion = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      effectiveFrom: yearMonth,
      expectedIncomeMinor: limitMinor.nullable().optional(),
      lines: z
        .array(
          z.object({
            categoryId: id,
            limitMinor,
            rollover: z.boolean().optional(),
            isFixed: z.boolean().optional(),
            alertPct: alertPct.optional(),
          }),
        )
        .max(MAX_LINES),
    }),
  )
  .handler(async ({ context, data }): Promise<Result<BudgetVersionView>> => {
    const { budgets, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return budgets.saveVersion(user.id, {
        effectiveFrom: data.effectiveFrom,
        ...(data.expectedIncomeMinor === undefined ? {} : { expectedIncomeMinor: data.expectedIncomeMinor }),
        lines: data.lines.map((line) => ({
          categoryId: line.categoryId,
          limitMinor: line.limitMinor,
          ...(line.rollover === undefined ? {} : { rollover: line.rollover }),
          ...(line.isFixed === undefined ? {} : { isFixed: line.isFixed }),
          ...(line.alertPct === undefined ? {} : { alertPct: line.alertPct }),
        })),
      });
    });
  });

/**
 * FR-B2 inline limit edit (↵), FR-B4 options (rollover, "Anggaran tetap", "Ingatkan di …"), and "Tambah kategori
 * anggaran": one line, from the period on.
 */
export const setBudgetLine = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      periodId: id,
      categoryId: id,
      limitMinor: limitMinor.optional(),
      rollover: z.boolean().optional(),
      isFixed: z.boolean().optional(),
      alertPct: alertPct.optional(),
    }),
  )
  .handler(async ({ context, data }): Promise<Result<BudgetVersionView>> => {
    const { budgets, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return budgets.setLine(user.id, data.periodId, {
        categoryId: data.categoryId,
        ...(data.limitMinor === undefined ? {} : { limitMinor: data.limitMinor }),
        ...(data.rollover === undefined ? {} : { rollover: data.rollover }),
        ...(data.isFixed === undefined ? {} : { isFixed: data.isFixed }),
        ...(data.alertPct === undefined ? {} : { alertPct: data.alertPct }),
      });
    });
  });

/** "Hapus dari anggaran", from the period on. */
export const removeBudgetLine = createServerFn({ method: 'POST' })
  .validator(z.object({ periodId: id, categoryId: id }))
  .handler(async ({ context, data }): Promise<Result<BudgetVersionView>> => {
    const { budgets, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return budgets.removeLine(user.id, data.periodId, data.categoryId);
    });
  });

/** FR-B3 "Pindahkan sisa": moves leftover of other lines into one; the total stays the same. */
export const moveBudgetLeftover = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      periodId: id,
      targetCategoryId: id,
      sources: z
        .array(z.object({ categoryId: id, amountMinor: z.bigint().positive() }))
        .min(1)
        .max(MAX_LINES),
    }),
  )
  .handler(async ({ context, data }): Promise<Result<{ moveId: string; deltas: LimitDelta[] }>> => {
    const { budgets, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return budgets.moveLeftover(user.id, data.periodId, {
        targetCategoryId: data.targetCategoryId,
        sources: data.sources,
      });
    });
  });

/** "Urungkan" of a move. */
export const undoBudgetMove = createServerFn({ method: 'POST' })
  .validator(z.object({ moveId: id }))
  .handler(async ({ context, data }): Promise<Result<{ removed: number }>> => {
    const { budgets, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return budgets.undoMove(user.id, data.moveId);
    });
  });

/** FR-B5 "Abaikan": the warning stays hidden until the end of the period. */
export const dismissBudgetAlert = createServerFn({ method: 'POST' })
  .validator(z.object({ periodId: id, categoryId: id }))
  .handler(async ({ context, data }): Promise<Result<null>> => {
    const { budgets, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      await budgets.dismissAlert(user.id, data.periodId, data.categoryId);
      return null;
    });
  });

/** "Tampilkan": shows a dismissed warning again. */
export const restoreBudgetAlert = createServerFn({ method: 'POST' })
  .validator(z.object({ periodId: id, categoryId: id }))
  .handler(async ({ context, data }): Promise<Result<null>> => {
    const { budgets, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      await budgets.restoreAlert(user.id, data.periodId, data.categoryId);
      return null;
    });
  });

/** FR-P2: what a start-day change would do (transition and proration, or the transactions that move). */
export const previewPeriodStart = createServerFn({ method: 'GET' })
  .validator(startDayChange)
  .handler(async ({ context, data }): Promise<Result<StartDayPreview>> => {
    const { periods, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return periods.previewStartDay(user.id, toStartDayChange(data));
    });
  });

/** FR-P2: applies a start-day change ((a) from the next period, (b) recalculating the current one). */
export const changePeriodStart = createServerFn({ method: 'POST' })
  .validator(startDayChange)
  .handler(async ({ context, data }): Promise<Result<StartDayPreview>> => {
    const { periods, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return periods.changeStartDay(user.id, toStartDayChange(data));
    });
  });
