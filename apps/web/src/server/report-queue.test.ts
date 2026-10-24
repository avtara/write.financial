// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { exampleEnv } from '../../test/env.ts';

const queues = vi.hoisted(() => {
  const created: { readonly name: string; readonly options: Record<string, unknown> }[] = [];
  const added: { readonly queue: string; readonly name: string; readonly data: unknown; readonly options: unknown }[] =
    [];
  const redisListeners: ((error: Error) => void)[] = [];
  return { created, added, redisListeners };
});

// No Valkey in unit tests: ioredis records its error listeners, the Queue constructor records what it was given.
vi.mock('ioredis', () => ({
  Redis: class {
    on(_event: string, listener: (error: Error) => void) {
      queues.redisListeners.push(listener);
      return this;
    }
  },
}));
vi.mock('bullmq', () => ({
  Queue: class {
    constructor(name: string, options: Record<string, unknown>) {
      queues.created.push({ name, options });
    }
    add(name: string, data: unknown, options: unknown) {
      queues.added.push({ queue: 'report-export', name, data, options });
      return Promise.resolve({});
    }
  },
}));

const logger = { error: vi.fn() };

beforeAll(() => {
  for (const [key, value] of Object.entries(exampleEnv({ LOG_LEVEL: 'silent' }))) {
    vi.stubEnv(key, value);
  }
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('createReportExportQueue', () => {
  it('creates the BullMQ queue lazily on the first export, prefixed, on its own connection', async () => {
    const { createReportExportQueue } = await import('./report-queue.ts');
    const queue = createReportExportQueue({ redis: 'redis://queue.example:6379', logger });
    expect(queues.created).toHaveLength(0);
    await queue.enqueue(
      {
        userId: '0192a6c4-0000-7000-8000-0000000000a1',
        reportId: '0192a6c4-0000-7000-8000-0000000000b2',
        format: 'pdf',
        email: false,
        options: { sections: ['summary', 'flow'], theme: 'light', paper: 'a4', maskAccountNumbers: false },
      },
      'req-1',
    );
    expect(queues.created).toHaveLength(1);
    expect(queues.created[0]).toMatchObject({ name: 'report-export', options: { prefix: 'wf' } });
    expect(queues.added[0]?.name).toBe('report-export');
    expect(queues.added[0]?.data).toEqual({
      userId: '0192a6c4-0000-7000-8000-0000000000a1',
      reportId: '0192a6c4-0000-7000-8000-0000000000b2',
      format: 'pdf',
      email: false,
      options: { sections: ['summary', 'flow'], theme: 'light', paper: 'a4', maskAccountNumbers: false },
    });
    // The job id deduplicates retries of one export and separates re-exports by request id.
    expect(queues.added[0]?.options).toMatchObject({
      jobId: 'rep.0192a6c4-0000-7000-8000-0000000000b2.pdf.req-1',
      attempts: 5,
    });
    // The queue is created once; further exports reuse it.
    await queue.enqueue(
      {
        userId: '0192a6c4-0000-7000-8000-0000000000a1',
        reportId: '0192a6c4-0000-7000-8000-0000000000b2',
        format: 'csv',
        email: false,
        options: { sections: ['largest'], theme: 'dark', paper: 'letter', maskAccountNumbers: true },
      },
      'req-2',
    );
    expect(queues.created).toHaveLength(1);
    expect(queues.added[1]?.options).toMatchObject({ jobId: 'rep.0192a6c4-0000-7000-8000-0000000000b2.csv.req-2' });
  });

  it('refuses a payload that does not match the queue schema, without connecting', async () => {
    const { createReportExportQueue } = await import('./report-queue.ts');
    const queue = createReportExportQueue({ redis: 'redis://queue.example:6379', logger });
    const invalid = {
      userId: '0192a6c4-0000-7000-8000-0000000000a1',
      reportId: '0192a6c4-0000-7000-8000-0000000000b2',
      format: 'doc',
      email: false,
      options: { sections: ['summary'], theme: 'light', paper: 'a4', maskAccountNumbers: false },
    } as unknown as Parameters<typeof queue.enqueue>[0];
    await expect(queue.enqueue(invalid, 'req-3')).rejects.toThrow('Invalid report-export payload');
    expect(queues.added).toHaveLength(2);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs Valkey connection errors instead of failing the request', async () => {
    const { createReportExportQueue } = await import('./report-queue.ts');
    createReportExportQueue({ redis: 'redis://queue.example:6379', logger });
    queues.redisListeners[0]?.(new Error('ECONNREFUSED'));
    expect(logger.error).toHaveBeenCalledWith(expect.anything(), 'report export redis connection error');
  });
});
