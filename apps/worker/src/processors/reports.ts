// SPDX-License-Identifier: AGPL-3.0-only
import { DEFAULT_REPORT_EXPORT_OPTIONS, JOBS, jobIds } from '@wf/jobs/queues';
import type { Enqueue } from '@wf/jobs/enqueue';
import type { ProcessorJob } from '../processors.ts';
import type { WorkerDb } from '../worker-db.ts';

export interface ReportsResult {
  /** Closed periods processed (0 when every closed period already has a report). */
  readonly generated: number;
  /** Final monthly reports queued for the PDF auto-send (FR-LP4), 0 with the opt-in off. */
  readonly autoSent: number;
}

export interface ReportsProcessorDeps {
  readonly db: Pick<WorkerDb, 'reports' | 'preferences'>;
  readonly now: () => Date;
  /** Queues the auto-send exports (`report-export`). */
  readonly enqueue: Enqueue;
}

/**
 * Daily per user after 00.10 local (`rep.{userId}.{date}`), FR-LP1: every closed period that has no monthly report yet
 * gets one. It runs after `period-close` (00.05), so the period is locked and final first; a stored report is never
 * rewritten, so a retry or a later dispatch only fills what is missing. With the auto-send opt-in on (FR-LP4 "Kirim
 * otomatis"), each newly generated final monthly report is queued as a PDF export that mails itself; the
 * `rep.{reportId}.pdf` job id makes retries and re-dispatches one job.
 */
export function createReportsProcessor({
  db,
  now,
  enqueue,
}: ReportsProcessorDeps): (job: ProcessorJob) => Promise<ReportsResult> {
  return async (job) => {
    const { userId } = JOBS.reports.parse(job.data);
    const at = now();
    const pending = await db.reports.pendingMonthly(userId);
    const generated: { readonly id: string }[] = [];
    for (const period of pending) {
      generated.push(await db.reports.generate(userId, { kind: 'monthly', periodId: period.id }, at));
    }
    let autoSent = 0;
    if (generated.length > 0 && (await db.preferences.get(userId)).reportAutoSend) {
      for (const report of generated) {
        // The payload schema keeps mutable arrays; the domain default is readonly.
        const options = { ...DEFAULT_REPORT_EXPORT_OPTIONS, sections: [...DEFAULT_REPORT_EXPORT_OPTIONS.sections] };
        await enqueue(
          'report-export',
          { userId, reportId: report.id, format: 'pdf', email: true, options },
          { jobId: jobIds['report-export'](report.id, 'pdf') },
        );
        autoSent += 1;
      }
    }
    return { generated: generated.length, autoSent };
  };
}
