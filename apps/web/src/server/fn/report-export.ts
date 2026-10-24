// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Server functions of the report export (FR-LP4, design yLlRY): "Ekspor" enqueues a `report-export` job for the
 * worker (the chromium renderer and the sheet builders live there, so the web only validates and queues) and
 * "Laporan tersimpan" lists the stored files. The user always comes from the session; another user's report (or an
 * unknown one) is refused as `NOT_FOUND` before anything is queued. The auto-send toggle ("Kirim otomatis tiap
 * tanggal 1") is the `reportAutoSend` preference the worker's reports job reads when a new final report appears.
 */
import { createServerFn } from '@tanstack/react-start';
import type { ReportFileMeta } from '@wf/db/report-files';
import { REPORT_FORMATS, REPORT_EXPORT_SECTIONS, type ReportFormat } from '@wf/domain/report';
import * as z from 'zod';
import { attempt, requireSession, type Result } from '../access.ts';
import { services } from '../runtime.ts';

/**
 * "Laporan-{label}.{format}" — the same name the auto-send email attaches; the download route serves it so a saved
 * file keeps its name across re-downloads. The label is a stored report's ("2026-09", "2026-Q3"), so it is safe in
 * a file name up to separators.
 */
export function exportFileName(label: string, format: ReportFormat): string {
  return `Laporan-${label.replaceAll(/[^\p{L}\p{N}-]+/gu, '-')}.${format}`;
}

/** The export dialog's choices; the schema mirrors the `report-export` job payload's options (strict like it). */
const OPTIONS = z.strictObject({
  sections: z.array(z.enum(REPORT_EXPORT_SECTIONS)).min(1),
  theme: z.enum(['light', 'dark']),
  paper: z.enum(['a4', 'letter']),
  maskAccountNumbers: z.boolean(),
});

/**
 * Queues one export of a stored report (a fresh file row per submit: the worker stores the bytes and the saved
 * list grows). A manual export is a download — the email path belongs to the monthly auto-send, which the worker
 * derives from the `reportAutoSend` preference itself.
 */
export const requestReportExport = createServerFn({ method: 'POST' })
  .validator(z.strictObject({ reportId: z.uuid(), format: z.enum(REPORT_FORMATS), options: OPTIONS }))
  .handler(({ context, data }): Promise<Result<object>> =>
    attempt(async () => {
      const all = await services();
      const { user } = await requireSession(context.session, {}, all.now());
      // Ownership: building the view refuses another user's (or an unknown) report with `NOT_FOUND`.
      await all.reports.get(user.id, data.reportId);
      // A fresh request id per submit: BullMQ still deduplicates retries of one export, while re-exporting with
      // changed options runs again instead of replaying the kept completed job.
      await all.reportExportQueue.enqueue(
        {
          userId: user.id,
          reportId: data.reportId,
          format: data.format,
          email: false,
          options: { ...data.options, sections: [...data.options.sections] },
        },
        crypto.randomUUID(),
      );
      return {};
    }),
  );

/** The user's stored export files ("Laporan tersimpan"), newest first. */
export const listReportFiles = createServerFn({ method: 'GET' })
  .validator(z.object({}))
  .handler(({ context }): Promise<Result<ReportFileMeta[]>> =>
    attempt(async () => {
      const all = await services();
      const { user } = await requireSession(context.session, {}, all.now());
      return all.reportFiles.list(user.id);
    }),
  );

/** The auto-send toggle of the export dialog ("Kirim otomatis tiap tanggal 1"). */
export const getReportAutoSend = createServerFn({ method: 'GET' })
  .validator(z.object({}))
  .handler(({ context }): Promise<Result<boolean>> =>
    attempt(async () => {
      const all = await services();
      const { user } = await requireSession(context.session, {}, all.now());
      return (await all.preferences.get(user.id)).reportAutoSend;
    }),
  );

/** Persists the auto-send toggle; the worker reads it when a new final monthly report appears. */
export const saveReportAutoSend = createServerFn({ method: 'POST' })
  .validator(z.object({ enabled: z.boolean() }))
  .handler(({ context, data }): Promise<Result<boolean>> =>
    attempt(async () => {
      const all = await services();
      const { user } = await requireSession(context.session, {}, all.now());
      return (await all.preferences.update(user.id, { reportAutoSend: data.enabled })).reportAutoSend;
    }),
  );
