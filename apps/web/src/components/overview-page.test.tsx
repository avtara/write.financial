// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { budgetStatus, periodsOverview, RECORD_BUDGET } from '../../test/budget-fixtures.ts';
import { dashboard, subscriptionsOverview, weekDashboard } from '../../test/dashboard-fixtures.ts';
import { ACCOUNTS, ARCHIVED, CATEGORIES, TAGS } from '../../test/ledger-fixtures.ts';
import { renderApp } from '../../test/render.tsx';
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
