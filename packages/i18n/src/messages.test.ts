// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { m } from './paraglide/messages.js';

describe('compiled messages', () => {
  it('render in both locales', () => {
    expect(m.language_name_id({}, { locale: 'en' })).toBe('Bahasa Indonesia');
    expect(m.language_name_en({}, { locale: 'id' })).toBe('English');
    expect(m.locale_switcher_label({}, { locale: 'id' })).toBe('Bahasa');
    expect(m.locale_switcher_label({}, { locale: 'en' })).toBe('Language');
  });

  it('pluralize per locale and format the count with the locale separators', () => {
    expect(m.transactions_count({ count: 1 }, { locale: 'en' })).toBe('1 transaction');
    expect(m.transactions_count({ count: 2 }, { locale: 'en' })).toBe('2 transactions');
    expect(m.transactions_count({ count: 1234 }, { locale: 'en' })).toBe('1,234 transactions');
    expect(m.transactions_count({ count: 1 }, { locale: 'id' })).toBe('1 transaksi');
    expect(m.transactions_count({ count: 1234 }, { locale: 'id' })).toBe('1.234 transaksi');
  });
});
