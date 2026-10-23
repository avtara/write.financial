// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Server functions of "Laporan" (FR-LP1–LP5): the page's saved reports with the newest final one, and the generation
 * of a report view from its request (a closed month, a quarter, a year, or a custom range). Generation and its
 * `LedgerError` refusals (`NOT_FOUND`, `INVALID_PERIOD`) come from `@wf/db/reports`; the user always comes from the
 * session.
 */
import { createServerFn } from '@tanstack/react-start';
import type { ReportRequest, ReportSummary, ReportView } from '@wf/db/reports';
import { localDateOf } from '@wf/db/ledger-core';
import type { LocalDate } from '@wf/domain/period';
import * as z from 'zod';
import { attempt, requireSession, type Result } from '../access.ts';
import { localDate } from '../inputs.ts';
import { services } from '../runtime.ts';

/** The reports page's data: the saved reports, the newest final monthly one, and the user's local date. */
export interface ReportsHome {
  /** Newest first. */
  readonly reports: ReportSummary[];
  /** `null` until a month is closed and its report generated ("Laporan final tersedia s.d. …"). */
  readonly latestFinal: ReportView | null;
  /** The user's local today, as the dashboard counts it. */
  readonly today: LocalDate;
}

const id = z.uuid();
const year = z.int().min(2000).max(2100);

/** What "Lihat" asks for: a stored month, a quarter, a year, or a custom range. */
const REPORT_REQUEST = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('monthly'), periodId: id }),
  z.object({ kind: z.literal('quarterly'), year, quarter: z.literal([1, 2, 3, 4]) }),
  z.object({ kind: z.literal('yearly'), year }),
  z.object({ kind: z.literal('custom'), from: localDate, to: localDate }),
]) as z.ZodType<ReportRequest>;

/** The "Laporan" page. */
export const getReportsHome = createServerFn({ method: 'GET' })
  .validator(z.object({}))
  .handler(({ context }): Promise<Result<ReportsHome>> =>
    attempt(async () => {
      const all = await services();
      const { user } = await requireSession(context.session, {}, all.now());
      const [reports, latestFinal] = await Promise.all([
        all.reports.list(user.id, { limit: 24 }),
        all.reports.latestFinal(user.id),
      ]);
      return { reports, latestFinal, today: localDateOf(all.now(), user.timezone ?? 'Asia/Jakarta') };
    }),
  );

/** Builds (or returns the stored) report of a request; refuses another user's period and bad ranges. */
export const viewReport = createServerFn({ method: 'POST' })
  .validator(REPORT_REQUEST)
  .handler(({ context, data }): Promise<Result<ReportView>> =>
    attempt(async () => {
      const all = await services();
      const { user } = await requireSession(context.session, {}, all.now());
      return all.reports.generate(user.id, data, all.now());
    }),
  );
