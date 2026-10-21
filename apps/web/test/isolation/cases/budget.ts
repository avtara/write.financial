// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/budget.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`.
 */
import type { BudgetHistoryEntry, BudgetStatus } from '@wf/db/budgets';
import type { Dashboard } from '@wf/db/dashboard';
import type { Payday, PeriodsOverview } from '@wf/db/periods';
import type { CategoryGroup } from '@wf/db/transaction-query';
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import type { BudgetCategoryDetail } from '../../../src/server/fn/budget.ts';
import {
  aId,
  as,
  bId,
  budgetedId,
  type Case,
  currentPeriod,
  ledgerIds,
  type Name,
  NOT_FOUND,
  ok,
  SOME_ID,
  superuser,
  UNAUTHENTICATED,
} from '../harness.ts';

export const cases = {
  listPeriods: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const ofB = await as<Result<PeriodsOverview>>('B', 'listPeriods');
      const ids = await ledgerIds(bId);
      expect(ofB.ok && ofB.value.periods.length).toBeGreaterThan(0);
      expect(ofB.ok && ofB.value.periods.filter((period) => !ids.includes(period.id as string))).toEqual([]);
      expect(ofB.ok && ids).toContain(ofB.ok && ofB.value.current.id);
    },
  },
  getBudgetStatus: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<BudgetStatus>>('B', 'getBudgetStatus', input);
      expect(ofB.ok && ofB.value.lines.map((line) => line.name)).toEqual(['Anggaran tag-b']);
      expect(ofB.ok && ofB.value.totals.limitMinor).toBe(500_000n);
      const [aPeriod] = await superuser<{ id: string }[]>`SELECT id::text FROM periods WHERE user_id = ${aId} LIMIT 1`;
      expect(await as('B', 'getBudgetStatus', { periodId: aPeriod?.id })).toEqual(NOT_FOUND);
    },
  },
  getDashboard: {
    input: () => ({ scope: 'month' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<Dashboard>>('B', 'getDashboard', input);
      expect(ofB.ok && ofB.value.period?.id).toBe(
        (
          await superuser<{ id: string }[]>`
        SELECT id::text FROM periods WHERE user_id = ${bId} ORDER BY start_date DESC LIMIT 1`
        )[0]?.id,
      );
      expect(ofB.ok && ofB.value.budget?.lines.map((line) => line.limitMinor)).toEqual([500_000n]);
      const [aPeriod] = await superuser<{ id: string }[]>`SELECT id::text FROM periods WHERE user_id = ${aId} LIMIT 1`;
      expect(await as('B', 'getDashboard', { scope: 'month', periodId: aPeriod?.id })).toEqual(NOT_FOUND);
      expect(await as('B', 'getDashboard', { scope: 'year' })).toMatchObject(ok({ scope: 'year' }));
    },
  },
  getBudgetHistory: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const ofB = await as<Result<BudgetHistoryEntry[]>>('B', 'getBudgetHistory');
      expect(ofB).toMatchObject(ok([{ totalMinor: 500_000n, lineCount: 1, changes: null }]));
      expect(await ledgerIds(bId)).toContain(ofB.ok && ofB.value[0]?.versionId);
    },
  },
  getBudgetFill: {
    input: () => ({ periodId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      // B has no spending before the current period, so nothing to suggest.
      expect(await as('B', 'getBudgetFill', { periodId: (await currentPeriod(bId)).id })).toEqual(ok([]));
      expect(await as('B', 'getBudgetFill', { periodId: (await currentPeriod(aId)).id })).toEqual(NOT_FOUND);
    },
  },
  listPeriodSpending: {
    input: () => ({ periodId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const ofB = await as<Result<CategoryGroup[]>>('B', 'listPeriodSpending', {
        periodId: (await currentPeriod(bId)).id,
      });
      const ids = await ledgerIds(bId);
      expect(ofB.ok && ofB.value.filter((group) => group.kind !== 'expense')).toEqual([]);
      expect(
        ofB.ok && ofB.value.filter((group) => group.categoryId !== null && !ids.includes(group.categoryId)),
      ).toEqual([]);
      expect(await as('B', 'listPeriodSpending', { periodId: (await currentPeriod(aId)).id })).toEqual(NOT_FOUND);
    },
  },
  getBudgetCategory: {
    input: () => ({ periodId: SOME_ID, categoryId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const period = await currentPeriod(bId);
      const ofB = await as<Result<BudgetCategoryDetail>>('B', 'getBudgetCategory', {
        periodId: period.id,
        categoryId: await budgetedId(bId),
      });
      expect(ofB).toMatchObject(
        ok({ months: [{ label: period.label, spentMinor: 0n, current: true }], transactions: [], transactionCount: 0 }),
      );
      expect(ofB.ok && ofB.value.daily.length).toBe(period.days);
      expect(
        await as('B', 'getBudgetCategory', {
          periodId: (await currentPeriod(aId)).id,
          categoryId: await budgetedId(bId),
        }),
      ).toEqual(NOT_FOUND);
      // A's category filters B's own transactions down to none.
      expect(
        await as('B', 'getBudgetCategory', { periodId: period.id, categoryId: await budgetedId(aId) }),
      ).toMatchObject(ok({ transactions: [], transactionCount: 0 }));
    },
  },
  getPeriodSettings: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const ofB = await as<Result<{ overview: PeriodsOverview; payday: Payday }>>('B', 'getPeriodSettings');
      const ids = await ledgerIds(bId);
      expect(ofB.ok && ofB.value.overview.periods.filter((period) => !ids.includes(period.id as string))).toEqual([]);
      expect(ofB.ok && ids).toContain(ofB.ok && ofB.value.overview.current.id);
      expect(ofB.ok && ofB.value.payday).toEqual({ day: null, merchant: null, count: 0 });
    },
  },
} satisfies Partial<Record<Name, Case>>;
