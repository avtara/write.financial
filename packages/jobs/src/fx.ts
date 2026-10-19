// SPDX-License-Identifier: AGPL-3.0-only
import { parseLocalDate } from '@wf/domain/period';
import type { Enqueue } from './enqueue.ts';
import { jobIds, type JobId } from './queues.ts';

/** FX rates are dated, scheduled, and deduplicated by the Jakarta day (WIB), as BI publishes them. */
export const FX_TIME_ZONE = 'Asia/Jakarta';

const WIB_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: FX_TIME_ZONE, dateStyle: 'short' });

/**
 * "Perbarui sekarang" (FR-ST1): enqueues the `fx` job with id `fx.{WIB date}`, so repeated presses on one day run it
 * once (BullMQ keeps the id while the job waits, runs, and for 7 days after it completes or 30 days after it fails).
 * The 08.00 and 17.00 WIB schedules run regardless. Resolves to the job id, which the caller can poll.
 */
export async function requestFxRefresh(enqueue: Enqueue, now: Date): Promise<JobId<'fx'>> {
  const jobId = jobIds.fx(parseLocalDate(WIB_DATE.format(now)));
  await enqueue('fx', {}, { jobId });
  return jobId;
}
