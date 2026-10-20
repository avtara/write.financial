// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { m } from '@wf/i18n/messages';
import { NAV_GROUPS } from './nav.ts';

describe('NAV_GROUPS', () => {
  it('lists Overview, Transactions, and Budget under MENU and Accounts & wallets under Akun', () => {
    expect(NAV_GROUPS.map((group) => group.label())).toEqual([m.nav_menu(), m.nav_group_account()]);
    expect(NAV_GROUPS.flatMap((group) => group.items.map((item) => item.to))).toEqual([
      '/',
      '/transactions',
      '/budget',
      '/accounts',
    ]);
    expect(m.nav_group_account({}, { locale: 'id' })).toBe('Akun');
  });

  it('labels every entry in both locales and gives the design’s G-shortcuts, each unique', () => {
    const items = NAV_GROUPS.flatMap((group) => group.items);
    expect(items.map((item) => item.label)).toEqual([
      m.nav_overview,
      m.nav_transactions,
      m.nav_budget,
      m.accounts_title,
    ]);
    expect(m.accounts_title({}, { locale: 'id' })).toBe('Rekening & dompet');
    expect(m.nav_overview({}, { locale: 'id' })).toBe('Ringkasan');
    expect(m.nav_overview({}, { locale: 'en' })).toBe('Overview');
    expect(m.nav_transactions({}, { locale: 'id' })).toBe('Transaksi');
    expect(m.nav_budget({}, { locale: 'id' })).toBe('Anggaran');
    expect(m.nav_budget({}, { locale: 'en' })).toBe('Budget');
    const shortcuts = items.flatMap((item) => (item.shortcut === undefined ? [] : [item.shortcut.join(' ')]));
    expect(shortcuts).toEqual(['G R', 'G T', 'G A']);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });

  it('badges Transactions with the count of the current period', () => {
    const items = NAV_GROUPS.flatMap((group) => group.items);
    expect(items.map((item) => item.badge)).toEqual([undefined, 'transactions', undefined, undefined]);
  });
});
