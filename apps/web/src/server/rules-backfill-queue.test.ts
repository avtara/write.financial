// SPDX-License-Identifier: AGPL-3.0-only
import type { RuleBackfillPreview } from '@wf/db/rule-backfill';
import { describe, expect, it, vi } from 'vitest';
import { ruleBackfillJobStatus, createRulesBackfillQueue } from './rules-backfill-queue.ts';

const queueMock = vi.hoisted(() => {
  const add = vi.fn(() => Promise.resolve({}));
  const getJob = vi.fn();
  const on = vi.fn();
  return { add, getJob, on };
});
vi.mock('bullmq', () => ({
  Queue: class {
    add = queueMock.add;
    getJob = queueMock.getJob;
  },
}));
vi.mock('ioredis', () => ({
  Redis: class {
    on = queueMock.on;
  },
}));

const USER = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c7d';
const OTHER = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c7e';
const REQUEST = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c7f';
const PREVIEW: RuleBackfillPreview = {
  proposals: [],
  totals: { matched: 0, changes: 0, noops: 0, blocked: 0 },
  ruleIds: [],
  version: 'v',
  truncated: false,
};
const job = (state: string, data: unknown = { userId: USER, requestId: REQUEST }) => ({
  data,
  returnvalue: PREVIEW,
  state: () => Promise.resolve(state),
  getState: () => Promise.resolve(state),
});

describe('createRulesBackfillQueue', () => {
  it('enqueues the deterministic job and reads its state only for the owner', async () => {
    const logger = { error: vi.fn() };
    const queue = createRulesBackfillQueue({ redis: 'redis://127.0.0.1:6379', logger });
    const [, onError] = queueMock.on.mock.calls[0] as [string, (error: Error) => void];
    onError(new Error('redis down'));
    expect(logger.error).toHaveBeenCalledWith(
      { err: new Error('redis down') },
      'rules backfill redis connection error',
    );
    const payload = { userId: USER, requestId: REQUEST };
    expect(await queue.enqueue(payload, 'request-1')).toBe(`rb.${USER}.request-1`);
    const [name, sent, options] = queueMock.add.mock.calls[0] as unknown as [
      string,
      unknown,
      { readonly jobId: string },
    ];
    expect(name).toBe('rules-backfill');
    expect(sent).toEqual(payload);
    expect(options.jobId).toBe(`rb.${USER}.request-1`);
    queueMock.getJob.mockResolvedValueOnce(undefined);
    expect(await queue.status('missing', USER)).toEqual({ status: 'failed' });
    queueMock.getJob.mockResolvedValueOnce(job('completed'));
    expect(await queue.status(`rb.${USER}.request-1`, USER)).toEqual({ status: 'completed', preview: PREVIEW });
  });
});

describe('ruleBackfillJobStatus', () => {
  it('returns the result only to the job owner', async () => {
    expect(await ruleBackfillJobStatus(job('completed', { userId: OTHER, requestId: REQUEST }), USER)).toEqual({
      status: 'failed',
    });
    expect(await ruleBackfillJobStatus(job('completed', { userId: USER }), USER)).toEqual({ status: 'failed' });
    expect(await ruleBackfillJobStatus(job('completed'), USER)).toEqual({ status: 'completed', preview: PREVIEW });
  });

  it('maps pending, failed, and unknown states', async () => {
    expect(await ruleBackfillJobStatus(job('waiting'), USER)).toEqual({ status: 'pending' });
    expect(await ruleBackfillJobStatus(job('active'), USER)).toEqual({ status: 'pending' });
    expect(await ruleBackfillJobStatus(job('failed'), USER)).toEqual({ status: 'failed' });
    expect(await ruleBackfillJobStatus(job('unknown'), USER)).toEqual({ status: 'pending' });
  });
});
