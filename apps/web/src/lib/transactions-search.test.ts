// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  hasFilters,
  listParamOf,
  listValues,
  MAX_RANGE_DAYS,
  queryOf,
  rangeOf,
  rangeParamOf,
  TRANSACTIONS_QUERY,
  TRANSACTIONS_SEARCH,
} from './transactions-search.ts';

const ID = '0192a6c4-0000-7000-8000-0000000000b1';
const OTHER = '0192a6c4-0000-7000-8000-0000000000b2';

describe('TRANSACTIONS_QUERY', () => {
  it('accepts every param', () => {
    const query = {
      period: '2026-10',
      range: '2026-09-14..2026-10-13',
      type: 'expense,transfer',
      category: `${ID},${OTHER}`,
      uncategorized: true,
      account: ID,
      tag: 'makan,liburan-bali',
      tagMode: 'all',
      min: 50_000,
      max: 1_000_000,
      attachment: false,
      source: 'manual,import',
      currency: 'IDR,USD',
      q: '  warteg #makan ',
      sort: 'amount_asc',
    };
    expect(TRANSACTIONS_QUERY.parse(query)).toEqual({ ...query, q: 'warteg #makan' });
    expect(TRANSACTIONS_QUERY.parse({})).toEqual({});
  });

  it.each([
    { period: '2026-13' },
    { range: '2026-10-13..2026-09-14' },
    { range: '2026-09-14' },
    { range: '2026-09-14..2026-10-13..2026-10-14' },
    { range: '2026-02-30..2026-03-01' },
    { range: '2026-03-01..2026-02-30' },
    { range: '2020-01-01..2026-01-01' },
    { type: 'investment' },
    { type: 'expense,' },
    { category: 'nope' },
    { account: Array.from({ length: 51 }, () => ID).join(',') },
    { tag: '#Makan' },
    { min: -1 },
    { max: 1.5 },
    { source: 'robot' },
    { currency: 'idr' },
    { q: 'x'.repeat(101) },
    { sort: 'name' },
  ])('rejects %o', (query) => {
    expect(TRANSACTIONS_QUERY.safeParse(query).success).toBe(false);
  });

  it(`allows a range of up to ${MAX_RANGE_DAYS} days`, () => {
    expect(TRANSACTIONS_QUERY.safeParse({ range: '2026-01-01..2026-01-01' }).success).toBe(true);
    expect(TRANSACTIONS_QUERY.safeParse({ range: '2022-01-01..2027-01-04' }).success).toBe(true);
    expect(TRANSACTIONS_QUERY.safeParse({ range: '2022-01-01..2027-01-05' }).success).toBe(false);
  });
});

describe('TRANSACTIONS_SEARCH', () => {
  it('keeps valid params, view and tx, and drops every invalid one', () => {
    expect(
      TRANSACTIONS_SEARCH.parse({
        period: '2026-10',
        type: 'investment',
        account: ID,
        min: 'lots',
        view: 'category',
        tx: OTHER,
      }),
    ).toEqual({ period: '2026-10', account: ID, view: 'category', tx: OTHER });
    expect(TRANSACTIONS_SEARCH.parse({ view: 'grid', tx: 'nope' })).toEqual({});
  });
});

describe('list params', () => {
  it('splits and joins comma-separated values', () => {
    expect(listValues(undefined)).toEqual([]);
    expect(listValues('')).toEqual([]);
    expect(listValues(`${ID},${OTHER}`)).toEqual([ID, OTHER]);
    expect(listParamOf([])).toBeUndefined();
    expect(listParamOf([ID, OTHER])).toBe(`${ID},${OTHER}`);
  });
});

describe('range params', () => {
  it('reads and writes from..to', () => {
    expect(rangeOf('2026-09-14..2026-10-13')).toEqual({ from: '2026-09-14', to: '2026-10-13' });
    expect(() => rangeOf('2026-09-14')).toThrow();
    expect(rangeParamOf('2026-09-14' as never, '2026-10-13' as never)).toBe('2026-09-14..2026-10-13');
  });
});

describe('queryOf', () => {
  it('drops view, tx, the layout keys (Settings), and unset keys', () => {
    const search = { period: '2026-10', account: ID, q: undefined, view: 'flat', tx: OTHER, settings: 'tags' };
    expect(queryOf(search as never)).toEqual({
      period: '2026-10',
      account: ID,
    });
  });
});

describe('hasFilters', () => {
  it('ignores the dates, the sort, the tag mode, and empty values', () => {
    expect(hasFilters({})).toBe(false);
    expect(
      hasFilters({
        period: '2026-10' as never,
        range: '2026-09-14..2026-10-13',
        sort: 'amount_desc',
        tagMode: 'all',
        q: '',
        tag: undefined,
      }),
    ).toBe(false);
    expect(hasFilters({ q: 'kopi' })).toBe(true);
    expect(hasFilters({ attachment: false })).toBe(true);
  });
});
