// SPDX-License-Identifier: AGPL-3.0-only
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createEnqueue } from '@wf/jobs/enqueue';
import { jobIds, QUEUE_PREFIX } from '@wf/jobs/queues';
export interface GmailQueue {
  enqueue(userId: string, triggerId: string): Promise<void>;
}
export function createGmailQueue({
  redis,
  logger,
}: {
  redis: string;
  logger: { error(fields: object, message: string): void };
}): GmailQueue {
  const connection = new Redis(redis, { lazyConnect: true, maxRetriesPerRequest: null });
  connection.on('error', (error: Error) => {
    logger.error({ err: error }, 'gmail redis connection error');
  });
  let queue: Queue | undefined;
  const enqueue = createEnqueue((name) => (queue ??= new Queue(name, { connection, prefix: QUEUE_PREFIX })));
  return {
    enqueue: async (userId, triggerId) => {
      await enqueue('gmail', { userId }, { jobId: jobIds.gmail(userId, triggerId) });
    },
  };
}
