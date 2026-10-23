// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/reports.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`. A and B each view a report of their own past week; B's list never
 * contains A's report, and B's monthly request aimed at A's period (or any unknown one) is refused as not found.
 */
import type { ReportsHome } from '../../../src/server/fn/reports.ts';
import type { Result } from '../../../src/server/access.ts';
import { expect } from 'vitest';
import {
  as,
  aId,
  bId,
  type Case,
  currentPeriod,
  type LocalDate,
  type Name,
  NOT_FOUND,
  ok,
  services,
  SOME_ID,
  UNAUTHENTICATED,
} from '../harness.ts';

const A_WEEK = {
  kind: 'custom',
  from: '2026-10-01' as LocalDate,
  to: '2026-10-07' as LocalDate,
} as const;
const B_WEEK = {
  kind: 'custom',
  from: '2026-10-02' as LocalDate,
  to: '2026-10-07' as LocalDate,
} as const;

/** Each user's own report of the first week of October, generated through the repository as the worker would. */
async function reportOf(userId: string, request: typeof A_WEEK | typeof B_WEEK): Promise<string> {
  return (await services.reports.generate(userId, request, new Date())).id;
}

export const cases = {
  getReportsHome: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const aReport = await reportOf(aId, A_WEEK);
      expect(await as<Result<ReportsHome>>('B', 'getReportsHome', {})).toMatchObject(
        ok({ reports: [], latestFinal: null }),
      );
      expect(await as('B', 'viewReport', { kind: 'custom', from: B_WEEK.from, to: B_WEEK.to })).toMatchObject(
        ok({ kind: 'custom', label: '2026-10-02/2026-10-07' }),
      );
      const home = await as<Result<ReportsHome>>('B', 'getReportsHome', {});
      expect(home.ok && home.value.reports.map((report) => report.id)).not.toContain(aReport);
      expect(home.ok && home.value.reports.map((report) => report.label)).toEqual(['2026-10-02/2026-10-07']);
      // Final monthly reports come from closed periods; neither user has closed one, so the newest final is absent.
      expect(home.ok && home.value.latestFinal).toBeNull();
    },
  },
  viewReport: {
    input: () => ({ kind: 'monthly', periodId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const aPeriod = (await currentPeriod(aId)).id;
      const bPeriod = (await currentPeriod(bId)).id;
      // Neither user's period is closed: B's own is INVALID_PERIOD, A's is invisible (NOT_FOUND).
      expect(await as('B', 'viewReport', { kind: 'monthly', periodId: bPeriod })).toEqual({
        ok: false,
        code: 'INVALID_PERIOD',
      });
      expect(await as('B', 'viewReport', input)).toEqual(NOT_FOUND);
      expect(await as('B', 'viewReport', { kind: 'monthly', periodId: aPeriod })).toEqual(NOT_FOUND);
      // A range that has not started is refused, a past range of B's own is built.
      expect(await as('B', 'viewReport', { kind: 'custom', from: '2027-01-01', to: '2027-01-31' })).toEqual({
        ok: false,
        code: 'INVALID_PERIOD',
      });
      expect(await as('B', 'viewReport', { kind: 'quarterly', year: 2026, quarter: 3 })).toMatchObject(
        ok({ kind: 'quarterly', status: 'provisional', label: '2026-Q3' }),
      );
    },
  },
} satisfies Partial<Record<Name, Case>>;
