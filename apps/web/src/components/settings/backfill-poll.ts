// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Waits for the `rules-backfill` worker job (FR-AI1). The dialog asked the server to enqueue it; this keeps polling the
 * result endpoint until the job completes, fails, the poll errors, or the deadline passes. Extracted from the dialog so
 * the retry/deadline behaviour is deterministic to test.
 */
import type { RuleBackfillPreview } from '@wf/db/rule-backfill';

export type RuleBackfillPoll =
  | { readonly status: 'completed'; readonly preview: RuleBackfillPreview }
  | { readonly status: 'failed' }
  | { readonly status: 'timeout' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'error'; readonly code?: string };

type Polled =
  | { readonly ok: true; readonly value: { readonly status: 'completed'; readonly preview: RuleBackfillPreview } }
  | { readonly ok: true; readonly value: { readonly status: 'pending' | 'failed' } }
  | { readonly ok: false; readonly code?: string };

export interface RuleBackfillPollOptions {
  /** Read one job result; throws or rejects when the server is unreachable. */
  readonly get: (jobId: string) => Promise<Polled>;
  /** Wait one interval before the next poll. */
  readonly wait: () => Promise<unknown>;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  /** Aborted when the dialog closes or its rule scope changes; no further polls then update the UI. */
  readonly signal?: AbortSignal;
}

export async function pollRuleBackfill(
  jobId: string,
  { get, wait, now = Date.now, timeoutMs = 30_000, signal }: RuleBackfillPollOptions,
): Promise<RuleBackfillPoll> {
  const isAborted = () => signal?.aborted ?? false;
  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (isAborted()) return { status: 'cancelled' };
    let polled: Polled;
    try {
      polled = await get(jobId);
    } catch {
      return { status: 'error' };
    }
    if (isAborted()) return { status: 'cancelled' };
    if (!polled.ok) return { status: 'error', ...(polled.code === undefined ? {} : { code: polled.code }) };
    if (polled.value.status === 'failed') return { status: 'failed' };
    if (polled.value.status === 'completed') return { status: 'completed', preview: polled.value.preview };
    await wait();
  }
  return isAborted() ? { status: 'cancelled' } : { status: 'timeout' };
}
