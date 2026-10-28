// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { m } from '@wf/i18n/messages';
import { NAV_GROUPS } from './nav.ts';

describe('NAV_GROUPS', () => {
  it('groups the pages into Utama, Rencana, and Aset & utang, three or four each', () => {
    expect(NAV_GROUPS.map((group) => group.label)).toEqual([m.nav_group_main, m.nav_group_plan, m.nav_group_assets]);
    expect(
      [m.nav_group_main, m.nav_group_plan, m.nav_group_assets].map((label) => [
        label({}, { locale: 'id' }),
        label({}, { locale: 'en' }),
      ]),
    ).toEqual([
      ['Utama', 'Main'],
      ['Rencana', 'Planning'],
      ['Aset & utang', 'Assets & debts'],
    ]);
    expect(NAV_GROUPS.map((group) => group.items.map((item) => item.to))).toEqual([
      ['/', '/transactions', '/review', '/reports'],
      ['/budget', '/subscriptions', '/calendar'],
      ['/accounts', '/goals', '/investments', '/debts'],
    ]);
  });

  it('labels every entry and gives the design’s G-shortcuts, each unique', () => {
    const items = NAV_GROUPS.flatMap((group) => group.items);
    expect(items.map((item) => item.label)).toEqual([
      m.nav_overview,
      m.nav_transactions,
      m.review_title,
      m.reports_title,
      m.nav_budget,
      m.nav_subscriptions,
      m.nav_calendar,
      m.accounts_title,
      m.nav_goals,
      m.invest_title,
      m.debts_title,
    ]);
    expect(items.map((item) => item.label())).toEqual([
      'Ringkasan',
      'Transaksi',
      'Perlu ditinjau',
      'Laporan',
      'Anggaran',
      'Langganan',
      'Kalender',
      'Rekening & dompet',
      'Tabungan',
      'Investasi',
      'Utang & cicilan',
    ]);
    const shortcuts = items.flatMap((item) =>
      item.shortcut === undefined ? [] : [`${item.to} ${item.shortcut.join(' ')}`],
    );
    expect(shortcuts).toEqual(['/ G R', '/transactions G T', '/budget G A', '/subscriptions G L']);
  });

  it('badges Transactions with the count of the current period, Subscriptions with the active ones, and Perlu ditinjau with what waits there', () => {
    const badges = NAV_GROUPS.flatMap((group) =>
      group.items.flatMap((item) => (item.badge === undefined ? [] : [[item.to, item.badge]])),
    );
    expect(badges).toEqual([
      ['/transactions', 'transactions'],
      ['/review', 'review'],
      ['/subscriptions', 'subscriptions'],
    ]);
  });
});
