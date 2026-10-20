// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TABLE_PREFS,
  LOCKED_COLUMNS,
  TABLE_PREFS,
  TRANSACTION_COLUMNS,
  tablePrefsOf,
  type TablePrefs,
} from './transaction-columns.ts';

const ids = (prefs: TablePrefs) => prefs.columns.map((column) => column.id);
const hidden = (prefs: TablePrefs) => prefs.columns.filter((column) => !column.visible).map((column) => column.id);

describe('DEFAULT_TABLE_PREFS', () => {
  it('shows every column but attachment, balance, and source, comfortably', () => {
    expect(ids(DEFAULT_TABLE_PREFS)).toEqual([...TRANSACTION_COLUMNS]);
    expect(hidden(DEFAULT_TABLE_PREFS)).toEqual(['attachment', 'balance', 'source']);
    expect(DEFAULT_TABLE_PREFS.density).toBe('comfortable');
    expect(LOCKED_COLUMNS).toEqual(['description', 'amount']);
  });
});

describe('TABLE_PREFS', () => {
  it('accepts the defaults and refuses unknown or repeated columns', () => {
    expect(TABLE_PREFS.parse(DEFAULT_TABLE_PREFS)).toEqual(DEFAULT_TABLE_PREFS);
    const column = { id: 'time', visible: true };
    expect(TABLE_PREFS.safeParse({ columns: [column, column], density: 'compact' }).success).toBe(false);
    expect(TABLE_PREFS.safeParse({ columns: [{ id: 'mood', visible: true }], density: 'compact' }).success).toBe(false);
    expect(TABLE_PREFS.safeParse({ columns: [], density: 'cozy' }).success).toBe(false);
  });
});

describe('tablePrefsOf', () => {
  it('gives the defaults for anything unreadable', () => {
    expect(tablePrefsOf(undefined)).toBe(DEFAULT_TABLE_PREFS);
    expect(tablePrefsOf({ columns: 'time' })).toBe(DEFAULT_TABLE_PREFS);
    expect(tablePrefsOf({ columns: [{ id: 'time' }], density: 'compact' })).toBe(DEFAULT_TABLE_PREFS);
  });

  it('keeps a complete saved order and visibility, showing locked columns', () => {
    const columns = [...DEFAULT_TABLE_PREFS.columns]
      .reverse()
      .map((column) => ({ ...column, visible: !column.visible }));
    const prefs = tablePrefsOf({ columns, density: 'compact' });
    expect(ids(prefs)).toEqual([...TRANSACTION_COLUMNS].reverse());
    expect(hidden(prefs)).toEqual(['account', 'category', 'tags', 'time']);
    expect(prefs.density).toBe('compact');
  });

  it('drops unknown and repeated columns and inserts missing ones after their default predecessor', () => {
    const prefs = tablePrefsOf({
      columns: [
        { id: 'amount', visible: true },
        { id: 'mood', visible: true },
        { id: 'category', visible: false },
        { id: 'amount', visible: false },
      ],
      density: 'cozy',
    });
    // time and description have no predecessor present when inserted, so they lead; tags follows description;
    // account follows category; attachment follows amount, and so on.
    expect(ids(prefs)).toEqual([
      'time',
      'description',
      'tags',
      'amount',
      'attachment',
      'balance',
      'source',
      'category',
      'account',
    ]);
    expect(hidden(prefs)).toEqual(['attachment', 'balance', 'source', 'category']);
    expect(prefs.density).toBe('comfortable');
  });
});
