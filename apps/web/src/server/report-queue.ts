// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The web's way into the worker queues (FR-LP4): one BullMQ producer for `report-export` on the same Valkey/Redis
 * the worker consumes from. The web cannot render exports itself (the chromium renderer and the sheet builders live
 * in the worker), so the export dialog enqueues here and the file appears in "Laporan tersimpan" once the processor
 * stored it. The payload is validated against `@wf/jobs`' schema, and the `rep.{reportId}.{format}.{requestId}` job
 * id deduplicates retries of one export while a fresh request id per submit lets a re-export run again.
 */
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createEnqueue, type QueuePort } from '@wf/jobs/enqueue';
import { jobIds, QUEUE_PREFIX, type JobPayload } from '@wf/jobs/queues';

export interface ReportExportQueue {
  /** Adds one export job; `requestId` (a fresh uuid per submit) separates re-exports from retries. */
  readonly enqueue: (payload: JobPayload<'report-export'>, requestId: string) => Promise<void>;
}

export interface ReportExportQueueOptions {
  /** `config.redis.url`. */
  readonly redis: string;
  readonly logger: { error: (fields: object, message: string) => void };
}

export function createReportExportQueue({ redis: url, logger }: ReportExportQueueOptions): ReportExportQueue {
  // BullMQ requires `maxRetriesPerRequest: null` on its connection; it connects on the first command.
  const connection = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null });
  connection.on('error', (error: Error) => {
    logger.error({ err: error }, 'report export redis connection error');
  });
  // The queue is created (and connected) on the first export; this producer only ever adds `report-export` jobs.
  let queue: QueuePort | undefined;
  const enqueue = createEnqueue((name) => (queue ??= new Queue(name, { connection, prefix: QUEUE_PREFIX })));
  return {
    enqueue: (payload, requestId) =>
      enqueue('report-export', payload, {
        jobId: jobIds['report-export'](payload.reportId, payload.format, requestId),
      }),
  };
}
