// SPDX-License-Identifier: AGPL-3.0-only
import type { RuleBackfillPreview } from '@wf/db/rule-backfill';
import { describe, expect, it, vi } from 'vitest';
import { pollRuleBackfill } from './backfill-poll.ts';

const PREVIEW: RuleBackfillPreview = {
  proposals: [],
  totals: { matched: 0, changes: 0, noops: 0, blocked: 0 },
  ruleIds: ['r-1'],
  version: 'rules-v1',
  truncated: false,
};
const completed = { ok: true as const, value: { status: 'completed' as const, preview: PREVIEW } };
const pending = { ok: true as const, value: { status: 'pending' as const } };
const wait = () => Promise.resolve();

describe('pollRuleBackfill', () => {
  it('returns the completed preview after pending polls', async () => {
    const get = vi.fn().mockResolvedValueOnce(pending).mockResolvedValueOnce(completed);
    expect(await pollRuleBackfill('job', { get, wait })).toEqual({ status: 'completed', preview: PREVIEW });
    expect(get).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledWith('job');
  });

  it('stops on a failed job, a rejected poll, and a rejected result', async () => {
    expect(
      await pollRuleBackfill('job', { get: () => Promise.resolve({ ok: true, value: { status: 'failed' } }), wait }),
    ).toEqual({ status: 'failed' });
    expect(await pollRuleBackfill('job', { get: () => Promise.reject(new TypeError('offline')), wait })).toEqual({
      status: 'error',
    });
    expect(await pollRuleBackfill('job', { get: () => Promise.resolve({ ok: false as const }), wait })).toEqual({
      status: 'error',
    });
    expect(
      await pollRuleBackfill('job', {
        get: () => Promise.resolve({ ok: false as const, code: 'NOT_FOUND' }),
        wait,
      }),
    ).toEqual({ status: 'error', code: 'NOT_FOUND' });
  });

  it('stops before polling, after a result, and after the interval when aborted', async () => {
    const before = new AbortController();
    before.abort();
    const get = vi.fn(() => Promise.resolve(pending));
    expect(await pollRuleBackfill('job', { get, wait, signal: before.signal })).toEqual({ status: 'cancelled' });
    expect(get).not.toHaveBeenCalled();

    const during = new AbortController();
    expect(
      await pollRuleBackfill('job', {
        get: () => {
          during.abort();
          return Promise.resolve(pending);
        },
        wait,
        signal: during.signal,
      }),
    ).toEqual({ status: 'cancelled' });

    const afterWait = new AbortController();
    const waits = vi.fn(() => {
      afterWait.abort();
      return Promise.resolve();
    });
    expect(await pollRuleBackfill('job', { get, wait: waits, signal: afterWait.signal })).toEqual({
      status: 'cancelled',
    });
    expect(get).toHaveBeenCalledTimes(1);

    const atDeadline = new AbortController();
    let clock = 0;
    expect(
      await pollRuleBackfill('job', {
        get,
        wait: () => {
          clock = 100;
          atDeadline.abort();
          return Promise.resolve();
        },
        now: () => clock,
        timeoutMs: 100,
        signal: atDeadline.signal,
      }),
    ).toEqual({ status: 'cancelled' });
  });

  it('gives up at the deadline instead of polling forever', async () => {
    let clock = 0;
    const get = vi.fn(() => Promise.resolve(pending));
    const advance = () => {
      clock += 100;
      return Promise.resolve();
    };
    expect(await pollRuleBackfill('job', { get, wait: advance, now: () => clock, timeoutMs: 200 })).toEqual({
      status: 'timeout',
    });
    expect(get).toHaveBeenCalledTimes(2);
    get.mockClear();
    expect(await pollRuleBackfill('job', { get, wait, now: () => 0, timeoutMs: 0 })).toEqual({ status: 'timeout' });
    expect(get).not.toHaveBeenCalled();
  });
});
