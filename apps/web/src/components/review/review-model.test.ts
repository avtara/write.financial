// SPDX-License-Identifier: AGPL-3.0-only
import type { ReviewItemView } from '@wf/db/review';
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { draftAmount, dueState, groupReviewItems, pendingTotals, type DraftItem } from './review-model.ts';

const d = (value: string) => value as LocalDate;
const at = new Date('2026-10-15T05:00:00Z');
const expense = { type: 'expense', accountId: 'bca', amountMinor: 186_000n, categoryId: null, occurredAt: at } as const;
const transfer = {
  type: 'transfer',
  fromAccountId: 'usd',
  toAccountId: 'jago',
  sentMinor: 1_150_000n,
  receivedMinor: 1_150_000n,
  occurredAt: at,
} as const;

const item = (id: string, extra: Partial<ReviewItemView>): ReviewItemView =>
  ({
    id,
    reason: 'due_occurrence',
    occurrence: null,
    payload: { kind: 'transaction', draft: expense },
    ...extra,
  }) as ReviewItemView;

describe('groupReviewItems', () => {
  it("splits the queue into the design's panels, keeping its order", () => {
    const occurrence = (sourceType: 'subscription' | 'recurrence') => ({ sourceType }) as ReviewItemView['occurrence'];
    const items = [
      item('ai', { reason: 'ai_suggestion' }),
      item('import', { reason: 'import_row' }),
      item('gmail', { reason: 'ai_suggestion', payload: { kind: 'gmail' } as never }),
      item('netflix', { occurrence: occurrence('subscription') }),
      item('sisihkan', { occurrence: occurrence('recurrence') }),
      item('orphan', {}),
      item('kopi', { reason: 'category_deleted', payload: { kind: 'category' } as never }),
      item('leftover', { reason: 'period_close_proposal', payload: { kind: 'leftover' } as never }),
      item('rollover', { reason: 'period_close_proposal', payload: { kind: 'rollover' } as never }),
    ];
    const ids = (list: readonly { id: string }[]) => list.map((entry) => entry.id);
    const groups = groupReviewItems(items);
    expect(ids(groups.ai)).toEqual(['ai', 'import']);
    expect(ids(groups.gmail)).toEqual(['gmail']);
    expect(ids(groups.bills)).toEqual(['netflix']);
    expect(ids(groups.recurring)).toEqual(['sisihkan', 'orphan']);
    expect(ids(groups.categories)).toEqual(['kopi']);
    expect(ids(groups.closing)).toEqual(['leftover', 'rollover']);
  });
});

describe('dueState', () => {
  it('says how late, or how early, a due item is', () => {
    expect(dueState(d('2026-10-15'), d('2026-10-15'))).toEqual({ kind: 'today' });
    expect(dueState(d('2026-10-09'), d('2026-10-15'))).toEqual({ kind: 'overdue', days: 6 });
    expect(dueState(d('2026-10-18'), d('2026-10-15'))).toEqual({ kind: 'upcoming', days: 3 });
  });
});

describe('draftAmount and pendingTotals', () => {
  it('reads the paying account and amount of entries and transfers, and adds them up per currency', () => {
    expect(draftAmount(expense)).toEqual({ accountId: 'bca', amountMinor: 186_000n });
    expect(draftAmount(transfer)).toEqual({ accountId: 'usd', amountMinor: 1_150_000n });
    const bills = [
      item('a', {}),
      item('b', { payload: { kind: 'transaction', draft: { ...expense, amountMinor: 45_000n } } }),
      item('c', { payload: { kind: 'transaction', draft: transfer } }),
    ] as DraftItem[];
    expect(pendingTotals(bills, (id) => (id === 'usd' ? 'USD' : 'IDR'))).toEqual([
      { currency: 'IDR', amountMinor: 231_000n },
      { currency: 'USD', amountMinor: 1_150_000n },
    ]);
  });
});
