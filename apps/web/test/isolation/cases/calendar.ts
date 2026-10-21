// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/calendar.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`.
 */
import { addDays } from '@wf/domain/period';
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import type { CalendarRange, CalendarYear } from '../../../src/server/fn/calendar.ts';
import { as, bId, type Case, idsOf, type LocalDate, type Name, ok, services, UNAUTHENTICATED } from '../harness.ts';

export const cases = {
  getCalendarRange: {
    input: () => ({ from: '2026-10-01', to: '2026-10-31' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const { today } = await services.schedules.listSubscriptions(bId);
      const range = { from: addDays(today, -20), to: addDays(today, 20) };
      const ofB = await as<Result<CalendarRange>>('B', 'getCalendarRange', range);
      const transactionsOfB = await idsOf('transactions', bId);
      const sourcesOfB = [...(await idsOf('subscriptions', bId)), ...(await idsOf('recurrences', bId))];
      expect(ofB.ok && ofB.value.rows.length).toBeGreaterThan(0);
      expect(ofB.ok && ofB.value.rows.filter((row) => !transactionsOfB.includes(row.id))).toEqual([]);
      expect(ofB.ok && ofB.value.scheduled.filter((item) => !sourcesOfB.includes(item.sourceId))).toEqual([]);
      expect(ofB.ok && ofB.value.days).toEqual(await services.transactionQuery.groupByDay(bId, range));
    },
  },
  getCalendarYear: {
    input: () => ({ year: 2026 }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const { today } = await services.schedules.listSubscriptions(bId);
      const year = Number(today.slice(0, 4));
      const ofB = await as<Result<CalendarYear>>('B', 'getCalendarYear', { year });
      expect(ofB).toEqual(
        ok({
          days: await services.transactionQuery.groupByDay(bId, {
            from: `${String(year)}-01-01` as LocalDate,
            to: `${String(year)}-12-31` as LocalDate,
          }),
          hasTransactions: true,
        }),
      );
    },
  },
} satisfies Partial<Record<Name, Case>>;
