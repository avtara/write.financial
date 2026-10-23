// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { m } from '@wf/i18n/messages';
import { NAV_GROUPS } from './nav.ts';

describe('NAV_GROUPS', () => {
  it('lists Overview, Transactions, Budget, Subscriptions, Calendar, Investasi, Laporan, Tabungan, Utang & cicilan, and Perlu ditinjau under MENU and Accounts & wallets under Akun', () => {
    expect(NAV_GROUPS.map((group) => group.label())).toEqual([m.nav_menu(), m.nav_group_account()]);
    expect(NAV_GROUPS.flatMap((group) => group.items.map((item) => item.to))).toEqual([
      '/',
      '/transactions',
      '/budget',
      '/subscriptions',
      '/calendar',
      '/investments',
      '/reports',
      '/goals',
      '/debts',
      '/review',
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
      m.nav_subscriptions,
      m.nav_calendar,
      m.invest_title,
      m.reports_title,
      m.nav_goals,
      m.debts_title,
      m.review_title,
      m.accounts_title,
    ]);
    expect(m.review_title({}, { locale: 'id' })).toBe('Perlu ditinjau');
    expect(m.accounts_title({}, { locale: 'id' })).toBe('Rekening & dompet');
    expect(m.nav_overview({}, { locale: 'id' })).toBe('Ringkasan');
    expect(m.nav_overview({}, { locale: 'en' })).toBe('Overview');
    expect(m.nav_transactions({}, { locale: 'id' })).toBe('Transaksi');
    expect(m.nav_budget({}, { locale: 'id' })).toBe('Anggaran');
    expect(m.nav_budget({}, { locale: 'en' })).toBe('Budget');
    expect(m.nav_subscriptions({}, { locale: 'id' })).toBe('Langganan');
    expect(m.nav_subscriptions({}, { locale: 'en' })).toBe('Subscriptions');
    expect(m.nav_calendar({}, { locale: 'id' })).toBe('Kalender');
    expect(m.nav_calendar({}, { locale: 'en' })).toBe('Calendar');
    expect(m.invest_title({}, { locale: 'id' })).toBe('Investasi');
    expect(m.invest_title({}, { locale: 'en' })).toBe('Investments');
    expect(m.reports_title({}, { locale: 'id' })).toBe('Laporan');
    expect(m.reports_title({}, { locale: 'en' })).toBe('Reports');
    expect(m.nav_goals({}, { locale: 'id' })).toBe('Tabungan');
    expect(m.nav_goals({}, { locale: 'en' })).toBe('Savings');
    expect(m.debts_title({}, { locale: 'id' })).toBe('Utang & cicilan');
    expect(m.debts_title({}, { locale: 'en' })).toBe('Debts & installments');
    const shortcuts = items.flatMap((item) => (item.shortcut === undefined ? [] : [item.shortcut.join(' ')]));
    expect(shortcuts).toEqual(['G R', 'G T', 'G A', 'G L']);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
  });

  it('badges Transactions with the count of the current period, Subscriptions with the active ones, and Perlu ditinjau with what waits there', () => {
    const items = NAV_GROUPS.flatMap((group) => group.items);
    expect(items.map((item) => item.badge)).toEqual([
      undefined,
      'transactions',
      undefined,
      'subscriptions',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'review',
      undefined,
    ]);
  });
});
