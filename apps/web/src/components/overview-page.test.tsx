// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { budgetStatus, periodsOverview, RECORD_BUDGET } from '../../test/budget-fixtures.ts';
import { dashboard, scheduledItem, subscriptionsOverview, weekDashboard } from '../../test/dashboard-fixtures.ts';
import { goalView } from '../../test/goal-fixtures.ts';
import { ACCOUNTS, ARCHIVED, CATEGORIES, TAGS } from '../../test/ledger-fixtures.ts';
import { renderApp } from '../../test/render.tsx';
import { DEFAULT_DASHBOARD_LAYOUT, updateCard, type DashboardLayout } from '../lib/dashboard-layout.ts';
import { OverviewPage, type OverviewData } from './overview-page.tsx';

const cards = vi.hoisted(() => ({
  category: vi.fn(),
  calendar: vi.fn(),
}));
vi.mock('./dashboard/money-flow-card.tsx', () => ({ MoneyFlowCard: () => <p>money flow</p> }));
vi.mock('./dashboard/cashflow-card.tsx', () => ({ CashflowCard: () => <p>cashflow</p> }));
vi.mock('./dashboard/calendar-card.tsx', () => ({
  CalendarCard: (props: unknown) => {
    cards.calendar(props);
    return <p>calendar</p>;
  },
}));
vi.mock('./dashboard/category-spending-card.tsx', () => ({
  CategorySpendingCard: (props: unknown) => {
    cards.category(props);
    return <p>categories</p>;
  },
}));
vi.mock('./dashboard/extra-cards.tsx', () => ({
  InvestmentsMiniCard: (props: { overview: unknown }) => <p>investments {props.overview === null ? 'failed' : 'ok'}</p>,
  GoalsCard: (props: { goals: unknown }) => <p>goals {props.goals === null ? 'failed' : 'ok'}</p>,
  BillsCard: (props: { items: unknown; today: string }) => (
    <p>
      bills {props.items === null ? 'failed' : 'ok'} {props.today}
    </p>
  ),
}));
const layouts = vi.hoisted(() => ({ saveDashboardLayout: vi.fn() }));
vi.mock('../server/fn/dashboard-layout.ts', () => layouts);
const toasts = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { undo: vi.fn() }) }));
vi.mock('@wf/ui/toast', () => toasts);
vi.mock('./ledger/quick-add-bar.tsx', () => ({ QuickAddBar: () => <p>quick add</p> }));
const record = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('./ledger/record-transaction.tsx', () => ({ useRecordTransaction: () => record }));
vi.mock('../server/fn/budget.ts', () => ({ getDashboard: vi.fn() }));
vi.mock('../server/fn/transactions.ts', () => ({ listTransactionRows: vi.fn() }));

const ok = <T,>(value: T) => ({ ok: true as const, value });
const failed = { ok: false as const, code: 'NOT_FOUND' };
const WITH_ACTIVITY = ACCOUNTS.map((account) => ({ ...account, transactionCount: 12 }));

function data(patch: Partial<OverviewData> = {}): OverviewData {
  return {
    accounts: ok({ baseCurrency: 'IDR', accounts: WITH_ACTIVITY, availableMinor: 55_023_000n, missingRates: [] }),
    categories: ok([...CATEGORIES]),
    tags: ok([...TAGS]),
    rules: ok([]),
    periods: ok(periodsOverview()),
    profile: ok({ name: 'Avtara K.', nickname: 'Avtara', locale: 'id', timezone: 'Asia/Jakarta' }),
    dashboard: ok(dashboard()),
    budget: ok(budgetStatus({ lines: [...RECORD_BUDGET.lines] as never })),
    shownBudget: null,
    subscriptions: ok(subscriptionsOverview()),
    scheduled: ok([]),
    layout: ok(DEFAULT_DASHBOARD_LAYOUT),
    goals: null,
    bills: null,
    loadedAt: new Date('2026-10-15T02:42:00Z'),
    ...patch,
  };
}

function renderOverview(overview: OverviewData, props: { refreshing?: boolean; offline?: boolean } = {}) {
  return renderApp(<OverviewPage data={overview} timeZone="Asia/Jakarta" {...props} />);
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('OverviewPage', () => {
  it('greets by nickname and shows the dashboard cards with the Quick Add bar', async () => {
    const { screen } = await renderOverview(data());
    await expect.element(screen.getByRole('heading', { level: 1, name: 'Selamat pagi, Avtara' })).toBeVisible();
    await expect.element(screen.getByText('Ini ringkasan uangmu periode 1–15 Oktober 2026.')).toBeVisible();
    await expect.element(screen.getByText('quick add')).toBeVisible();
    await expect.element(screen.getByRole('region', { name: 'Angka utama' })).toBeVisible();
    await expect.element(screen.getByRole('region', { name: 'Rekening & dompet' })).toBeVisible();
    await expect.element(screen.getByRole('region', { name: 'Anggaran Kategori' })).toBeVisible();
    await expect.element(screen.getByRole('region', { name: 'Langganan' })).toBeVisible();
    await expect.element(screen.getByText('calendar')).toBeVisible();
    expect(cards.category).toHaveBeenLastCalledWith(
      expect.objectContaining({
        caption: '1–31 Oktober 2026',
        budget: expect.objectContaining({ readOnly: false }) as unknown,
      }),
    );
    expect(cards.calendar).toHaveBeenLastCalledWith(
      expect.objectContaining({
        periodLabels: ['2026-10', '2026-09', '2026-08'],
        navigation: { label: 'Okt 2026', previous: { period: '2026-09' }, next: null },
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Catat Transaksi N' }));
    expect(record.open).toHaveBeenCalledOnce();
  });

  it('uses the shown period’s budget, none outside a month, and dims while refreshing', async () => {
    const september = budgetStatus({ readOnly: true });
    const { screen } = await renderOverview(data({ shownBudget: ok(september) }), { refreshing: true });
    expect(cards.category).toHaveBeenLastCalledWith(expect.objectContaining({ budget: september }));
    await expect.element(screen.getByRole('status')).toMatchTextContent('Memperbarui ringkasan…');
    await renderOverview(
      data({
        dashboard: ok(weekDashboard()),
        periods: failed,
        subscriptions: failed,
        scheduled: null,
        profile: ok({ name: 'Avtara K.', nickname: null, locale: 'id', timezone: 'Asia/Jakarta' }),
      }),
    );
    expect(cards.category).toHaveBeenLastCalledWith(expect.objectContaining({ budget: null, caption: '12–18 Okt' }));
    expect(cards.calendar).toHaveBeenLastCalledWith(expect.objectContaining({ periodLabels: [], scheduled: null }));
  });

  it('marks data shown from the last load while offline', async () => {
    const { screen } = await renderOverview(data(), { offline: true });
    await expect
      .element(screen.getByText('Kamu sedang offline · menampilkan data terakhir dari 15 Okt 09.42'))
      .toBeVisible();
  });

  it('shows the 3-step setup without transactions', async () => {
    const accounts = ok({ baseCurrency: 'IDR', accounts: [...ACCOUNTS], availableMinor: 0n, missingRates: [] });
    const { screen } = await renderOverview(data({ accounts, budget: failed }));
    await expect.element(screen.getByRole('heading', { level: 1, name: 'Selamat datang, Avtara' })).toBeVisible();
    await expect.element(screen.getByText('Belum ada data. Tambahkan rekening pertamamu untuk mulai.')).toBeVisible();
    await expect.element(screen.getByText('1 / 3 selesai')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Catat transaksi' }));
    expect(record.open).toHaveBeenCalledOnce();
    await expect.element(screen.getByRole('group', { name: 'Pemasukan' })).toMatchTextContent('belum ada data');
  });

  it('shows the setup without the Quick Add bar before an account, with what could not load', async () => {
    const accounts = ok({ baseCurrency: 'IDR', accounts: [ARCHIVED], availableMinor: 0n, missingRates: [] });
    const { screen } = await renderOverview(data({ accounts, profile: failed, tags: failed }));
    await expect.element(screen.getByRole('heading', { level: 1, name: 'Selamat datang,' })).toBeVisible();
    expect(screen.getByText('quick add').query()).toBeNull();
    await expect.element(screen.getByText('1 / 3 selesai')).toBeVisible();
    const { screen: none } = await renderOverview(data({ accounts: failed, budget: failed }));
    await expect.element(none.getByText('0 / 3 selesai')).toBeVisible();
  });

  it('says when the dashboard could not be loaded', async () => {
    const { screen } = await renderOverview(data({ dashboard: { ok: false, code: 'INVALID_PERIOD' } }));
    await expect.element(screen.getByText('Ringkasan gagal dimuat')).toBeVisible();
    const { screen: categories } = await renderOverview(data({ categories: failed }));
    await expect.element(categories.getByText('Ringkasan gagal dimuat').last()).toBeVisible();
  });
});

describe('OverviewPage dashboard layout (FR-D3)', () => {
  const subscriptionsOff = updateCard(DEFAULT_DASHBOARD_LAYOUT, 'subscriptions', { visible: false });
  const editBar = () => page.getByRole('region', { name: 'Mode atur dashboard' });
  const customize = () => userEvent.click(page.getByRole('button', { name: 'Atur dashboard' }));
  const saveButton = () => editBar().getByRole('button', { name: 'Simpan tata letak' });
  const addable = () => page.getByRole('region', { name: 'Kartu lain yang bisa ditambahkan' });

  beforeEach(async () => {
    await page.viewport(1440, 900);
    layouts.saveDashboardLayout.mockImplementation(({ data: layout }: { data: DashboardLayout }) =>
      Promise.resolve(ok(layout)),
    );
  });

  afterEach(async () => {
    await page.viewport(414, 896);
  });

  it('arranges the cards by the saved layout, with the addable ones that are on', async () => {
    const layout = updateCard(updateCard(subscriptionsOff, 'goals', { visible: true }), 'bills', { visible: true });
    const { screen } = await renderOverview(
      data({
        layout: ok(layout),
        goals: ok([goalView({ id: 'g1', name: 'Dana Darurat' })]),
        bills: ok([scheduledItem({ sourceId: 'netflix', dueDate: '2026-10-16' as never })]),
      }),
    );
    await expect.element(screen.getByText('goals ok')).toBeVisible();
    await expect.element(screen.getByText('bills ok 2026-10-15')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Langganan' }).query()).toBeNull();
    // Without the subscriptions, the card is left out too, whatever the layout says.
    const { screen: none } = await renderOverview(data({ subscriptions: failed }));
    await expect.element(none.getByText('calendar').last()).toBeVisible();
    expect(none.getByRole('region', { name: 'Langganan' }).query()).toBeNull();
  });

  it('saves a removed card, then "Urungkan" saves the previous layout back', async () => {
    const { screen, router } = await renderOverview(data());
    const invalidate = vi.spyOn(router, 'invalidate');
    await customize();
    await expect.element(editBar()).toMatchTextContent('Seret ⋮⋮ untuk memindah kartu · klik × untuk menghapus kartu');
    await expect.element(saveButton()).toBeDisabled();
    await expect.element(editBar().getByRole('button', { name: 'Reset ke default' })).toBeDisabled();
    // Editing replaces the header's action until it ends.
    expect(screen.getByRole('button', { name: 'Atur dashboard' }).query()).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Hapus kartu Langganan' }));
    // The removed card leaves the grid and waits with the cards to add.
    await expect.element(addable().getByRole('button', { name: 'Tambah Langganan' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Pindahkan Langganan' }).query()).toBeNull();
    await userEvent.click(saveButton());
    expect(layouts.saveDashboardLayout).toHaveBeenLastCalledWith({ data: subscriptionsOff });
    await expect.element(editBar()).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Langganan' }).query()).toBeNull();
    // Nothing new to read: no reload.
    expect(invalidate).not.toHaveBeenCalled();
    expect(toasts.toast.undo).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Tata letak dashboard disimpan',
        description: 'Tersimpan di akunmu, juga di perangkat lain.',
        undoLabel: 'Urungkan',
      }),
    );

    const { onUndo } = toasts.toast.undo.mock.lastCall?.[0] as { onUndo: () => void };
    onUndo();
    await expect.element(screen.getByRole('region', { name: 'Langganan' })).toBeVisible();
    expect(layouts.saveDashboardLayout).toHaveBeenLastCalledWith({ data: DEFAULT_DASHBOARD_LAYOUT });
    expect(toasts.toast).toHaveBeenLastCalledWith({ tone: 'info', title: 'Tata letak sebelumnya dikembalikan' });
  });

  it('previews added cards until they are saved, then reads their data', async () => {
    const { screen, router } = await renderOverview(data());
    const invalidate = vi.spyOn(router, 'invalidate').mockResolvedValue();
    await customize();
    for (const name of ['Tujuan tabungan', 'Pengingat tagihan']) {
      await userEvent.click(screen.getByRole('button', { name: `Tambah ${name}` }));
    }
    await expect.poll(() => screen.getByText('Isinya tampil setelah tata letak disimpan.').all()).toHaveLength(2);
    await userEvent.click(saveButton());
    await vi.waitFor(() => {
      expect(invalidate).toHaveBeenCalledOnce();
    });
    await expect.element(screen.getByRole('heading', { name: 'Tujuan tabungan' })).toBeVisible();
  });

  it('keeps the draft when saving fails, and Reset, "Kelola kartu", and Batal work on the draft', async () => {
    const { screen } = await renderOverview(data({ layout: ok(subscriptionsOff) }));
    await customize();
    await userEvent.click(addable().getByRole('button', { name: 'Tambah Langganan' }));

    layouts.saveDashboardLayout.mockResolvedValueOnce(failed).mockRejectedValueOnce(new Error('offline'));
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await userEvent.click(saveButton());
      await vi.waitFor(() => {
        expect(toasts.toast).toHaveBeenLastCalledWith({
          tone: 'error',
          title: 'Tata letak tidak bisa disimpan. Coba lagi.',
        });
      });
      await expect.element(editBar()).toBeVisible();
    }
    expect(toasts.toast.undo).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Hapus kartu Arus Uang' }));
    await userEvent.click(editBar().getByRole('button', { name: 'Reset ke default' }));
    await expect.element(screen.getByRole('button', { name: 'Hapus kartu Arus Uang' })).toBeVisible();

    await userEvent.click(editBar().getByRole('button', { name: 'Kelola kartu' }));
    const sheet = screen.getByRole('dialog', { name: 'Kelola kartu dashboard' });
    await userEvent.click(sheet.getByRole('switch', { name: /Pemasukan vs Pengeluaran/ }));
    // Switched off, the card moves from the order to the ones to add.
    await expect
      .element(
        sheet
          .getByRole('region', { name: 'Bisa ditambahkan' })
          .getByRole('switch', { name: /Pemasukan vs Pengeluaran/ }),
      )
      .not.toBeChecked();
    expect(
      sheet
        .getByRole('region', { name: 'Urutan di dashboard' })
        .getByRole('switch', { name: /Pemasukan vs Pengeluaran/ })
        .query(),
    ).toBeNull();
    await userEvent.keyboard('{Escape}');
    await expect.element(sheet).not.toBeInTheDocument();
    await expect.element(addable().getByRole('button', { name: 'Tambah Pemasukan vs Pengeluaran' })).toBeVisible();

    await userEvent.click(editBar().getByRole('button', { name: 'Batal' }));
    await expect.element(editBar()).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Langganan' }).query()).toBeNull();
    expect(layouts.saveDashboardLayout).toHaveBeenCalledTimes(2);
  });

  it('reports a failed "Urungkan" without claiming the old layout is back', async () => {
    const { screen } = await renderOverview(data());
    await customize();
    await userEvent.click(screen.getByRole('button', { name: 'Hapus kartu Langganan' }));
    await userEvent.click(saveButton());
    await vi.waitFor(() => {
      expect(toasts.toast.undo).toHaveBeenCalledOnce();
    });
    layouts.saveDashboardLayout.mockResolvedValueOnce(failed);
    (toasts.toast.undo.mock.lastCall?.[0] as { onUndo: () => void }).onUndo();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith(expect.objectContaining({ tone: 'error' }));
    });
    expect(screen.getByRole('region', { name: 'Langganan' }).query()).toBeNull();
  });

  it('offers no customizing offline, without a readable layout, or without the cards', async () => {
    const { screen } = await renderOverview(data(), { offline: true });
    await expect.element(screen.getByRole('region', { name: 'Anggaran Kategori' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Atur dashboard' }).query()).toBeNull();
    const { screen: unreadable } = await renderOverview(data({ layout: failed }));
    // The defaults are shown instead.
    await expect.element(unreadable.getByRole('region', { name: 'Langganan' }).last()).toBeVisible();
    expect(unreadable.getByRole('button', { name: 'Atur dashboard' }).query()).toBeNull();
    const { screen: broken } = await renderOverview(data({ dashboard: failed }));
    await expect.element(broken.getByText('Ringkasan gagal dimuat').last()).toBeVisible();
    expect(broken.getByRole('button', { name: 'Atur dashboard' }).query()).toBeNull();
  });

  it('follows a newer saved layout from the loader', async () => {
    function Reloading() {
      const [layout, setLayout] = useState(ok(DEFAULT_DASHBOARD_LAYOUT));
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setLayout(ok(subscriptionsOff));
            }}
          >
            reload
          </button>
          <OverviewPage data={data({ layout })} timeZone="Asia/Jakarta" />
        </>
      );
    }
    const { screen } = await renderApp(<Reloading />);
    await expect.element(screen.getByRole('region', { name: 'Langganan' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'reload' }));
    await expect.element(screen.getByRole('region', { name: 'Langganan' })).not.toBeInTheDocument();
  });
});
