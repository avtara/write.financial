// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Read server functions of the M2 screens: the period switcher (FR-P1), the budget page (FR-B2), and the dashboard
 * (FR-D1/D2, FR-S7 custom range). The user always comes from the session.
 */
import { createServerFn } from '@tanstack/react-start';
import type { BudgetStatus } from '@wf/db/budgets';
import type { Dashboard } from '@wf/db/dashboard';
import type { PeriodsOverview } from '@wf/db/periods';
import * as z from 'zod';
import { attempt, requireSession, type Result } from '../access.ts';
import { localDate } from '../inputs.ts';
import { services } from '../runtime.ts';

/** FR-P1: the periods up to today (rows newest first), the current one, and the next two. */
export const listPeriods = createServerFn({ method: 'GET' }).handler(
  async ({ context }): Promise<Result<PeriodsOverview>> => {
    const { periods, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return periods.list(user.id);
    });
  },
);

/** FR-B2: the budget page of a period (default: the current one). */
export const getBudgetStatus = createServerFn({ method: 'GET' })
  .validator(z.object({ periodId: z.uuid().optional() }))
  .handler(async ({ context, data }): Promise<Result<BudgetStatus>> => {
    const { budgets, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return budgets.status(user.id, data.periodId === undefined ? {} : { periodId: data.periodId });
    });
  });

const dashboardRequest = z.discriminatedUnion('scope', [
  z.object({ scope: z.literal('week') }),
  z.object({ scope: z.literal('month'), periodId: z.uuid().optional() }),
  z.object({ scope: z.literal('year'), year: z.number().int().min(1000).max(9998).optional() }),
  z.object({ scope: z.literal('range'), from: localDate, to: localDate }),
]);

/** FR-D1/D2, FR-S7: the dashboard for a week, a period, a year, or a custom range. */
export const getDashboard = createServerFn({ method: 'GET' })
  .validator(dashboardRequest)
  .handler(async ({ context, data }): Promise<Result<Dashboard>> => {
    const { dashboard, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return dashboard.get(user.id, data);
    });
  });
