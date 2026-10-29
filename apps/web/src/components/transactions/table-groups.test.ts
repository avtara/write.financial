// SPDX-License-Identifier: AGPL-3.0-only
import type { CategoryGroup, DayGroup, TransactionRow } from '@wf/db/transaction-query';
import type { LocalDate } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import {
  groupKeyOf,
  highlightParts,
  searchWords,
  selectRange,
  tableLayout,
  tableModeOf,
  tagMatches,
  type GroupTotals,
} from './table-groups.ts';

function row(id: string, patch: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id,
    type: 'expense',
    occurredAt: new Date('2026-10-15T05:00:00Z'),
    localDate: '2026-10-15' as LocalDate,
    merchant: null,
    description: null,
    categoryId: 'food',
    accountId: 'bca',
    toAccountId: null,
    amountMinor: -10_000n,
    currency: 'IDR',
    receivedMinor: null,
    receivedCurrency: null,
    amountBaseMinor: -10_000n,
    feeMinor: null,
    feeBaseMinor: 0n,
    fxDiffBaseMinor: null,
    tags: [],
    hasAttachment: false,
    hasNote: false,
    source: 'manual',
    splitParentId: null,
    ...patch,
  };
}

const day = (date: string, inMinor: bigint, outMinor: bigint, count: number): DayGroup => ({
  date: date as LocalDate,
  inMinor,
  outMinor,
  count,
});
const category = (categoryId: string | null, kind: 'expense' | 'income', totalMinor: bigint): CategoryGroup => ({
  categoryId,
  kind,
  totalMinor,
  count: 7,
  shareBps: 3500,
});

const TOTALS: GroupTotals = {
  days: [day('2026-10-15', 0n, 180_000n, 3)],
  categories: [
    category('bills', 'expense', 620_000n),
    category('food', 'expense', 352_000n),
    category('salary', 'income', 6_200_000n),
    category(null, 'expense', 5_000n),
  ],
  summary: { transferMinor: 3_000_000n, transferCount: 1 },
};

describe('tableModeOf', () => {
  it('defaults to By day and flattens it under an amount sort', () => {
    expect(tableModeOf({})).toBe('day');
    expect(tableModeOf({ sort: 'date_asc' })).toBe('day');
    expect(tableModeOf({ sort: 'amount_desc' })).toBe('flat');
    expect(tableModeOf({ view: 'category', sort: 'amount_asc' })).toBe('category');
    expect(tableModeOf({ view: 'flat' })).toBe('flat');
  });
});

describe('groupKeyOf', () => {
  it('keys expenses and incomes by category, the rest by type', () => {
    expect(groupKeyOf({ type: 'expense', categoryId: 'food' })).toBe('expense:food');
    expect(groupKeyOf({ type: 'income', categoryId: null })).toBe('income:none');
    expect(groupKeyOf({ type: 'transfer', categoryId: null })).toBe('transfer');
  });
});

describe('tableLayout', () => {
  const a = row('a');
  const b = row('b');
  const c = row('c', { localDate: '2026-10-14' as LocalDate });

  it('By day: a header per date with the day totals, or the loaded rows when the day is unknown', () => {
    const layout = tableLayout([a, b, c], 'day', TOTALS);
    expect(layout.rows).toEqual([a, b, c]);
    expect(layout.items).toEqual([
      { kind: 'day', key: 'day:2026-10-15', date: '2026-10-15', count: 3, netMinor: -180_000n },
      { kind: 'row', key: 'a', index: 0 },
      { kind: 'row', key: 'b', index: 1 },
      { kind: 'day', key: 'day:2026-10-14', date: '2026-10-14', count: 1, netMinor: 0n },
      { kind: 'row', key: 'c', index: 2 },
    ]);
  });

  it('By category: groups in the order of the totals, transfers and unknown groups after', () => {
    const bills = row('bills-1', { categoryId: 'bills' });
    const salary = row('salary-1', { type: 'income', categoryId: 'salary', amountBaseMinor: 6_200_000n });
    const transfer = row('t-1', { type: 'transfer', categoryId: null });
    const adjustment = row('adj-1', { type: 'adjustment', categoryId: null, amountBaseMinor: 5_000n });
    const layout = tableLayout([transfer, a, salary, bills, adjustment, b], 'category', TOTALS);
    expect(layout.rows.map((item) => item.id)).toEqual(['bills-1', 'a', 'b', 'salary-1', 't-1', 'adj-1']);
    expect(layout.items).toEqual([
      {
        kind: 'category',
        key: 'expense:bills',
        type: 'expense',
        categoryId: 'bills',
        count: 7,
        totalMinor: -620_000n,
        shareBps: 3500,
      },
      { kind: 'row', key: 'bills-1', index: 0 },
      expect.objectContaining({ key: 'expense:food', totalMinor: -352_000n }),
      { kind: 'row', key: 'a', index: 1 },
      { kind: 'row', key: 'b', index: 2 },
      expect.objectContaining({ key: 'income:salary', totalMinor: 6_200_000n }),
      { kind: 'row', key: 'salary-1', index: 3 },
      {
        kind: 'category',
        key: 'transfer',
        type: 'transfer',
        categoryId: null,
        count: 1,
        totalMinor: 3_000_000n,
        shareBps: null,
      },
      { kind: 'row', key: 't-1', index: 4 },
      {
        kind: 'category',
        key: 'adjustment',
        type: 'adjustment',
        categoryId: null,
        count: 1,
        totalMinor: 5_000n,
        shareBps: null,
      },
      { kind: 'row', key: 'adj-1', index: 5 },
    ]);
  });

  it('Flat: just the rows', () => {
    expect(tableLayout([a, b], 'flat', TOTALS).items).toEqual([
      { kind: 'row', key: 'a', index: 0 },
      { kind: 'row', key: 'b', index: 1 },
    ]);
  });
});

describe('selectRange', () => {
  it('adds the rows between anchor and target, in either direction', () => {
    const rows = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
    expect([...selectRange(new Set(['x']), rows, 1, 3)]).toEqual(['x', 'b', 'c', 'd']);
    expect([...selectRange(new Set(), rows, 2, 0)]).toEqual(['a', 'b', 'c']);
  });
});

describe('search highlight', () => {
  it('takes the words of a search, without #tags', () => {
    expect(searchWords(undefined)).toEqual([]);
    expect(searchWords('  Kantor  #rumah gojek ')).toEqual(['kantor', 'gojek']);
  });

  it('splits text into matching and other parts, escaping the words', () => {
    expect(highlightParts('Gojek — ke kantor', [])).toEqual([{ text: 'Gojek — ke kantor', match: false }]);
    expect(highlightParts('Gojek — ke Kantor', ['kantor'])).toEqual([
      { text: 'Gojek — ke ', match: false },
      { text: 'Kantor', match: true },
    ]);
    expect(highlightParts('a+b a+b', ['a+b'])).toEqual([
      { text: 'a+b', match: true },
      { text: ' ', match: false },
      { text: 'a+b', match: true },
    ]);
  });

  it('matches tag chips by word or #tag', () => {
    expect(tagMatches('kantor', undefined)).toBe(false);
    expect(tagMatches('kantor', 'kan')).toBe(true);
    expect(tagMatches('ruang-kerja', '#kerja')).toBe(true);
    expect(tagMatches('rumah', 'kantor  ')).toBe(false);
  });
});
