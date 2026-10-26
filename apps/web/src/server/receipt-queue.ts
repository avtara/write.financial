// SPDX-License-Identifier: AGPL-3.0-only
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createEnqueue } from '@wf/jobs/enqueue';
import { jobIds, QUEUE_PREFIX } from '@wf/jobs/queues';

export interface ReceiptQueue {
  enqueue(userId: string, receiptId: string): Promise<void>;
}
export function createReceiptQueue({
  redis,
  logger,
}: {
  redis: string;
  logger: { error(fields: object, message: string): void };
}): ReceiptQueue {
  const connection = new Redis(redis, { lazyConnect: true, maxRetriesPerRequest: null });
  connection.on('error', (error: Error) => {
    logger.error({ err: error }, 'receipt redis connection error');
  });
  let queue: Queue | undefined;
  const enqueue = createEnqueue((name) => (queue ??= new Queue(name, { connection, prefix: QUEUE_PREFIX })));
  return {
    enqueue: async (userId, receiptId) => {
      await enqueue('ocr', { userId, receiptId }, { jobId: jobIds.ocr(userId, receiptId) });
    },
  };
}
