// SPDX-License-Identifier: AGPL-3.0-only
import type { SubscriptionStatus } from '@wf/domain/subscriptions';
import type { LocalDate } from '@wf/domain/period';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { subscription } from '../../../test/dashboard-fixtures.ts';
import { ACCOUNTS, CATEGORIES, categoryId, OVO } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import {
  S_CANVA,
  S_CHATGPT,
  S_HEADSPACE,
  S_NETFLIX,
  S_YOUTUBE,
  seedOverview,
} from '../../../test/subscription-fixtures.ts';
import { SubscriptionTable, type SubscriptionTableProps, type TableFilter } from './subscription-table.tsx';

const d = (value: string) => value as LocalDate;

function actions() {
  return {
    open: vi.fn(),
    edit: vi.fn(),
    markPaid: vi.fn(),
    changeAccount: vi.fn(),
    pause: vi.fn(),
    cancel: vi.fn(),
    reactivate: vi.fn(),
    remove: vi.fn(),
  };
}

function Harness({
  initialFilter = null,
  ...props
}: Omit<SubscriptionTableProps, 'tab' | 'onTabChange' | 'filter' | 'onClearFilter'> & {
  readonly initialFilter?: TableFilter | null;
}) {
  const [tab, setTab] = useState<SubscriptionStatus>('active');
  const [filter, setFilter] = useState(initialFilter);
  return (
    <SubscriptionTable
      {...props}
      tab={tab}
      onTabChange={setTab}
      filter={filter}
      onClearFilter={() => {
        setFilter(null);
      }}
    />
  );
}

async function renderTable(patch: Partial<Parameters<typeof Harness>[0]> = {}) {
  const handlers = actions();
  const { screen } = await renderApp(
    <Harness
      overview={seedOverview()}
      accounts={ACCOUNTS}
      categories={CATEGORIES}
      locale="id"
      actions={handlers}
      {...patch}
    />,
  );
  return { screen, actions: handlers };
}

describe('SubscriptionTable', () => {
  it('golden: the active subscriptions with next bill, account, usage, and price per month and year', async () => {
    const { screen, actions: handlers } = await renderTable();
    const table = screen.getByRole('region', { name: 'Semua langganan' });
    await expect.element(table.getByRole('tab', { name: 'Aktif 7' })).toHaveAttribute('aria-selected', 'true');
    const rows = table.getByRole('row');
    expect(rows.elements()).toHaveLength(8);
    await expect
      .element(rows.nth(1))
      .toMatchTextContent(
        /^iCloud\+200 GB · Tanpa kategori9 Okt 2026belum dikonfirmasiBCA TahapanSeringRp45\.000Rp540\.000\/tahun/,
      );
    await expect.element(rows.nth(1)).toHaveAttribute('data-overdue', 'true');
    await expect
      .element(rows.nth(2))
      .toMatchTextContent(
        /^NetflixPremium 4K · Hiburan18 Okt 20263 hari lagiBCA TahapanKadangRp186\.000Rp2\.230\.000\/tahun/,
      );
    await expect.element(rows.nth(4)).toMatchTextContent(/YouTube Premium.*22 Okt 20267 hari lagi.*Belum dinilai/);
    await expect.element(rows.nth(5)).toMatchTextContent(/ChatGPT.*Bank Jago.*\+10,03%Rp329\.000Rp3\.950\.000\/tahun/);
    await expect.element(rows.nth(6)).toMatchTextContent(/Fit Hub.*3 Nov 2026lunas bulan ini.*Jarang/);
    await expect
      .element(rows.nth(7))
      .toMatchTextContent(
        /^NiagahosterHosting \+ domain · tahunan · Tanpa kategori5 Okt 2027lunas 5 Okt.*Rp55\.075Rp660\.000\/tahun/,
      );
    await expect
      .element(table.getByText(/^Total 7 langganan aktif · Rp904\.900\/bulan \+ Rp660\.900\/tahun$/))
      .toBeVisible();
    await table.getByRole('button', { name: 'Netflix' }).click();
    expect(handlers.open).toHaveBeenCalledWith(S_NETFLIX);
  });

  it('runs every action of an active subscription’s ⋮ menu, with the paying accounts and their balances', async () => {
    const { screen, actions: handlers } = await renderTable();
    const open = async () => {
      await screen.getByRole('button', { name: 'Aksi untuk ChatGPT' }).click();
    };
    await open();
    await expect.element(screen.getByRole('menuitem', { name: /^Tandai sudah dibayar ?28 Okt$/ })).toBeVisible();
    await screen.getByRole('menuitem', { name: /^Tandai sudah dibayar ?28 Okt$/ }).click();
    expect(handlers.markPaid).toHaveBeenCalledWith(S_CHATGPT, 'occ-chatgpt-2026-10-28');
    for (const [name, handler] of [
      ['Edit', handlers.edit],
      ['Riwayat tagihan', handlers.open],
      ['Jeda', handlers.pause],
      ['Batalkan langganan', handlers.cancel],
    ] as const) {
      await open();
      await screen.getByRole('menuitem', { name }).click();
      expect(handler).toHaveBeenCalledWith(S_CHATGPT);
    }
    await open();
    await screen.getByRole('menuitem', { name: 'Ganti rekening' }).click();
    await userEvent.keyboard('{ArrowRight}');
    const accounts = screen.getByRole('menu').last();
    await expect.element(accounts.getByText('Berlaku mulai tagihan 28 Okt')).toBeVisible();
    await expect
      .element(accounts.getByRole('menuitem', { name: /^OVO kurang untuk 28 Okt: Rp243\.000 Rp86\.000$/ }))
      .toBeVisible();
    await expect
      .element(accounts.getByRole('menuitem', { name: /^Bank Jago/ }))
      .toHaveAttribute('aria-current', 'true');
    // Investment accounts and archived ones do not pay subscriptions.
    await expect.element(accounts.getByRole('menuitem', { name: /Gotrade/ })).not.toBeInTheDocument();
    // Focus the item itself rather than arrowing to it: where the focus lands as the submenu opens depends on timing.
    (accounts.getByRole('menuitem', { name: /^OVO / }).element() as HTMLElement).focus();
    await userEvent.keyboard('{Enter}');
    expect(handlers.changeAccount).toHaveBeenCalledWith(S_CHATGPT, OVO);
  });

  it('cannot mark a bill paid that is not scheduled yet', async () => {
    const { screen } = await renderTable();
    await screen.getByRole('button', { name: 'Aksi untuk Niagahoster' }).click();
    await expect
      .element(screen.getByRole('menuitem', { name: 'Tandai sudah dibayar' }))
      .toHaveAttribute('aria-disabled', 'true');
    await screen.getByRole('menuitem', { name: 'Ganti rekening' }).click();
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(screen.getByText(/Berlaku mulai/)).not.toBeInTheDocument();
  });

  it('lists paused and cancelled subscriptions with what they saved, and reactivates or deletes them', async () => {
    const { screen, actions: handlers } = await renderTable();
    await screen.getByRole('tab', { name: 'Dijeda 1' }).click();
    const paused = screen.getByRole('tabpanel');
    await expect
      .element(paused.getByRole('row').nth(1))
      .toMatchTextContent(
        /^HHeadspaceTanpa kategoriLanjut 1 Des 2026dijeda sejak 1 SepBCA TahapanDijedaRp70\.000hemat Rp140\.000/,
      );
    await expect
      .element(paused.getByText(/^1 langganan dijeda · tidak muncul di kalender · hemat Rp70\.000\/bulan$/))
      .toBeVisible();
    await paused.getByRole('button', { name: 'Aksi untuk Headspace' }).click();
    await expect.element(screen.getByRole('menuitem', { name: 'Jeda' })).not.toBeInTheDocument();
    await screen.getByRole('menuitem', { name: 'Aktifkan lagi' }).click();
    expect(handlers.reactivate).toHaveBeenCalledWith(S_HEADSPACE);

    await screen.getByRole('tab', { name: 'Dibatalkan 1' }).click();
    const cancelled = screen.getByRole('tabpanel');
    await expect
      .element(cancelled.getByRole('row').nth(1))
      .toMatchTextContent(
        /^CCanva ProTanpa kategoriBerakhir 31 Mar 20266 bulan laluBCA TahapanDibatalkanRp95\.000hemat Rp665\.000/,
      );
    await expect
      .element(cancelled.getByText(/^1 dibatalkan · bisa diaktifkan lagi dari menu ⋮ · total dihemat Rp665\.000$/))
      .toBeVisible();
    await cancelled.getByRole('button', { name: 'Aksi untuk Canva Pro' }).click();
    await expect.element(screen.getByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
    await expect.element(screen.getByRole('menuitem', { name: 'Ganti rekening' })).not.toBeInTheDocument();
    await screen.getByRole('menuitem', { name: 'Hapus langganan' }).click();
    expect(handlers.remove).toHaveBeenCalledWith(S_CANVA);
  });

  it('narrows the rows to a category or compared subscriptions, until cleared', async () => {
    const fun = categoryId('system:entertainment');
    const { screen } = await renderTable({ initialFilter: { categoryId: fun } });
    await expect
      .element(screen.getByText(/^3 langganan Hiburan · 34,57% dari total · Rp331\.900\/bulan$/))
      .toBeVisible();
    expect(screen.getByRole('row').elements()).toHaveLength(4);
    await screen.getByRole('button', { name: 'Hapus filter kategori' }).click();
    expect(screen.getByRole('row').elements()).toHaveLength(8);
    await screen.unmount();

    const none = await renderTable({ initialFilter: { categoryId: null } });
    await expect.element(none.screen.getByText(/^4 langganan Tanpa kategori · 65,43% dari total/)).toBeVisible();
    await none.screen.unmount();
    const unknown = await renderTable({ initialFilter: { categoryId: 'gone' } });
    await expect.element(unknown.screen.getByText('0 langganan')).toBeVisible();
    await unknown.screen.unmount();
    const compared = await renderTable({
      initialFilter: { ids: ['spotify', 'youtube'], label: 'Fungsi dobel: musik' },
    });
    await expect.element(compared.screen.getByText('Fungsi dobel: musik')).toBeVisible();
    expect(compared.screen.getByRole('row').elements()).toHaveLength(3);
  });

  it('shows due-today and far bills, unknown accounts and categories, and empty tabs', async () => {
    const today = subscription({
      id: 'today',
      name: 'Today',
      payFromAccountId: 'gone',
      categoryId: 'gone',
      nextBill: { occurrenceId: 'o', dueDate: d('2026-10-15'), status: 'due_review' },
    });
    const overview = seedOverview({
      subscriptions: [today, { ...S_YOUTUBE, nextBill: null, nextBillingDate: d('2026-11-30') }],
      counts: { active: 2, paused: 0, cancelled: 0 },
      monthSchedule: [],
    });
    const { screen } = await renderTable({ overview });
    await expect
      .element(screen.getByRole('row').nth(1))
      .toMatchTextContent(/^TTodayTanpa kategori15 Okt 2026hari ini—/);
    await expect.element(screen.getByRole('row').nth(2)).toMatchTextContent(/30 Nov 202646 hari lagi/);
    await expect.element(screen.getByText(/^Total 2 langganan aktif · Rp904\.900\/bulan$/)).toBeVisible();
    await screen.getByRole('tab', { name: 'Dijeda 0' }).click();
    await expect.element(screen.getByText('Tidak ada langganan di sini.')).toBeVisible();
  });

  it('shows paused and cancelled ones without dates', async () => {
    const overview = seedOverview({
      subscriptions: [
        { ...S_HEADSPACE, pausedOn: null, pausedUntil: null },
        { ...S_CANVA, endsOn: null },
      ],
    });
    const { screen } = await renderTable({ overview });
    await screen.getByRole('tab', { name: 'Dijeda 1' }).click();
    await expect
      .element(screen.getByRole('tabpanel').getByRole('row').nth(1))
      .toMatchTextContent(/^HHeadspaceTanpa kategori—BCA/);
    await screen.getByRole('tab', { name: 'Dibatalkan 1' }).click();
    await expect
      .element(screen.getByRole('tabpanel').getByRole('row').nth(1))
      .toMatchTextContent(/^CCanva ProTanpa kategori—BCA/);
  });
});
