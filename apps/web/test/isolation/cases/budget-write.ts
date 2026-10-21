// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/budget-write.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`.
 */
import type { BudgetVersionView } from '@wf/db/budgets';
import type { StartDayPreview } from '@wf/db/periods';
import type { LimitDelta } from '@wf/domain/budget';
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import {
  aBudgetRows,
  aId,
  as,
  bId,
  budgetedId,
  type Case,
  count,
  currentPeriod,
  INVALID_CATEGORY,
  ledgerIds,
  type Name,
  NOT_FOUND,
  ok,
  services,
  SOME_ID,
  spareId,
  UNAUTHENTICATED,
} from '../harness.ts';

export const cases = {
  saveBudgetVersion: {
    input: () => ({ effectiveFrom: '2026-10', lines: [] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aBudgetRows();
      const { label } = await currentPeriod(bId);
      const own = { categoryId: await budgetedId(bId), limitMinor: 500_000n };
      const foreign = { categoryId: await budgetedId(aId), limitMinor: 1n };
      expect(await as('B', 'saveBudgetVersion', { effectiveFrom: label, lines: [own, foreign] })).toEqual(
        INVALID_CATEGORY,
      );
      const spare = { categoryId: await spareId(bId), limitMinor: 200_000n, rollover: true, alertPct: 80 };
      const saved = await as<Result<BudgetVersionView>>('B', 'saveBudgetVersion', {
        effectiveFrom: label,
        lines: [own, spare],
      });
      expect(saved).toMatchObject(ok({ effectiveFrom: label, totalMinor: 700_000n }));
      expect(await ledgerIds(bId)).toContain(saved.ok && saved.value.id);
      // Back to the single line of `beforeAll`.
      expect(await as('B', 'saveBudgetVersion', { effectiveFrom: label, lines: [own] })).toMatchObject(
        ok({ totalMinor: 500_000n }),
      );
      expect(await aBudgetRows()).toEqual(a);
    },
  },
  setBudgetLine: {
    input: () => ({ periodId: SOME_ID, categoryId: SOME_ID, limitMinor: 1n }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aBudgetRows();
      const periodId = (await currentPeriod(bId)).id as string;
      const spare = await spareId(bId);
      expect(
        await as('B', 'setBudgetLine', { periodId: (await currentPeriod(aId)).id, categoryId: spare, limitMinor: 1n }),
      ).toEqual(NOT_FOUND);
      expect(await as('B', 'setBudgetLine', { periodId, categoryId: await budgetedId(aId), limitMinor: 1n })).toEqual(
        INVALID_CATEGORY,
      );
      expect(
        await as('B', 'setBudgetLine', { periodId, categoryId: spare, limitMinor: 300_000n, alertPct: 100 }),
      ).toMatchObject(ok({ totalMinor: 800_000n }));
      await services.budgets.removeLine(bId, periodId, spare);
      expect(await aBudgetRows()).toEqual(a);
    },
  },
  removeBudgetLine: {
    input: () => ({ periodId: SOME_ID, categoryId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aBudgetRows();
      const periodId = (await currentPeriod(bId)).id as string;
      const spare = await spareId(bId);
      await services.budgets.setLine(bId, periodId, { categoryId: spare, limitMinor: 100_000n });
      const aPeriod = (await currentPeriod(aId)).id;
      expect(await as('B', 'removeBudgetLine', { periodId: aPeriod, categoryId: await budgetedId(aId) })).toEqual(
        NOT_FOUND,
      );
      expect(await as('B', 'removeBudgetLine', { periodId, categoryId: await budgetedId(aId) })).toEqual(NOT_FOUND);
      expect(await as('B', 'removeBudgetLine', { periodId, categoryId: spare })).toMatchObject(
        ok({ totalMinor: 500_000n }),
      );
      expect(await aBudgetRows()).toEqual(a);
    },
  },
  moveBudgetLeftover: {
    input: () => ({
      periodId: SOME_ID,
      targetCategoryId: SOME_ID,
      sources: [{ categoryId: SOME_ID, amountMinor: 1n }],
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aBudgetRows();
      const periodId = (await currentPeriod(bId)).id as string;
      const spare = await spareId(bId);
      await services.budgets.setLine(bId, periodId, { categoryId: spare, limitMinor: 100_000n });
      const sources = [{ categoryId: await budgetedId(bId), amountMinor: 50_000n }];
      expect(
        await as('B', 'moveBudgetLeftover', {
          periodId: (await currentPeriod(aId)).id,
          targetCategoryId: spare,
          sources,
        }),
      ).toEqual(NOT_FOUND);
      expect(
        await as('B', 'moveBudgetLeftover', { periodId, targetCategoryId: await budgetedId(aId), sources }),
      ).toEqual({ ok: false, code: 'INVALID_BUDGET' });
      const moved = await as<Result<{ moveId: string; deltas: LimitDelta[] }>>('B', 'moveBudgetLeftover', {
        periodId,
        targetCategoryId: spare,
        sources,
      });
      expect(moved.ok && moved.value.deltas).toEqual(
        expect.arrayContaining([
          { categoryId: spare, deltaMinor: 50_000n },
          { categoryId: sources[0]?.categoryId, deltaMinor: -50_000n },
        ]),
      );
      await services.budgets.undoMove(bId, moved.ok ? moved.value.moveId : '');
      await services.budgets.removeLine(bId, periodId, spare);
      expect(await aBudgetRows()).toEqual(a);
    },
  },
  undoBudgetMove: {
    input: () => ({ moveId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      // A move of each user: from the budgeted line into the spare one.
      const moves = new Map<string, string>();
      for (const userId of [aId, bId]) {
        const periodId = (await currentPeriod(userId)).id as string;
        const spare = await spareId(userId);
        await services.budgets.setLine(userId, periodId, { categoryId: spare, limitMinor: 100_000n });
        const { moveId } = await services.budgets.moveLeftover(userId, periodId, {
          targetCategoryId: spare,
          sources: [{ categoryId: await budgetedId(userId), amountMinor: 10_000n }],
        });
        moves.set(userId, moveId);
      }
      const a = await aBudgetRows();
      expect(await as('B', 'undoBudgetMove', { moveId: moves.get(aId) })).toEqual(NOT_FOUND);
      expect(await aBudgetRows()).toEqual(a);
      expect(await as('B', 'undoBudgetMove', { moveId: moves.get(bId) })).toEqual(ok({ removed: 2 }));
      expect(await count('budget_period_overrides', `user_id = '${bId}'`)).toBe(0);
      await services.budgets.removeLine(bId, (await currentPeriod(bId)).id as string, await spareId(bId));
    },
  },
  dismissBudgetAlert: {
    input: () => ({ periodId: SOME_ID, categoryId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aBudgetRows();
      const periodId = (await currentPeriod(bId)).id as string;
      const categoryId = await budgetedId(bId);
      expect(await as('B', 'dismissBudgetAlert', { periodId: (await currentPeriod(aId)).id, categoryId })).toEqual(
        NOT_FOUND,
      );
      expect(await as('B', 'dismissBudgetAlert', { periodId, categoryId: await budgetedId(aId) })).toEqual(
        INVALID_CATEGORY,
      );
      expect(await as('B', 'dismissBudgetAlert', { periodId, categoryId })).toEqual(ok(null));
      const status = await services.budgets.status(bId, { periodId });
      expect(status.lines.map((line) => [line.categoryId, line.dismissed])).toEqual([[categoryId, true]]);
      await services.budgets.restoreAlert(bId, periodId, categoryId);
      expect(await aBudgetRows()).toEqual(a);
    },
  },
  restoreBudgetAlert: {
    input: () => ({ periodId: SOME_ID, categoryId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const periodId = (await currentPeriod(bId)).id as string;
      const aPeriod = (await currentPeriod(aId)).id as string;
      const categoryId = await budgetedId(bId);
      await services.budgets.dismissAlert(bId, periodId, categoryId);
      await services.budgets.dismissAlert(aId, aPeriod, await budgetedId(aId));
      const a = await aBudgetRows();
      expect(a.dismissals).toHaveLength(1);
      expect(await as('B', 'restoreBudgetAlert', { periodId: aPeriod, categoryId: await budgetedId(aId) })).toEqual(
        NOT_FOUND,
      );
      // B's period with A's category: the delete reaches none of A's rows.
      expect(await as('B', 'restoreBudgetAlert', { periodId, categoryId: await budgetedId(aId) })).toEqual(ok(null));
      expect(await aBudgetRows()).toEqual(a);
      expect(await as('B', 'restoreBudgetAlert', { periodId, categoryId })).toEqual(ok(null));
      expect(await count('budget_alert_dismissals', `user_id = '${bId}'`)).toBe(0);
    },
  },
  previewPeriodStart: {
    input: () => ({ day: 25, apply: 'next_period' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await aBudgetRows();
      const ofB = await as<Result<StartDayPreview>>('B', 'previewPeriodStart', input);
      expect(ofB).toMatchObject(ok({ apply: 'next_period', fromDay: 1, toDay: 25 }));
      expect(ofB.ok && ofB.value.transition?.limitMinor).toBe(500_000n);
      expect(await services.periods.list(bId)).toMatchObject({ startDay: 1, mode: 'fixed_day' });
      expect(await aBudgetRows()).toEqual(a);
    },
  },
  // Last of the period cases: B's start day changes (and is set back).
  changePeriodStart: {
    input: () => ({ day: 25, apply: 'next_period' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await aBudgetRows();
      expect(await as('B', 'changePeriodStart', input)).toMatchObject(ok({ apply: 'next_period', toDay: 25 }));
      expect(await services.periods.list(bId)).toMatchObject({ startDay: 25 });
      expect(await aBudgetRows()).toEqual(a);
      await services.periods.changeStartDay(bId, { day: 1, apply: 'next_period' });
    },
  },
} satisfies Partial<Record<Name, Case>>;
