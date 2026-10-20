// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { periodsOverview, SEPTEMBER } from '../../../test/budget-fixtures.ts';
import { dashboard, rangeDashboard, weekDashboard, yearDashboard } from '../../../test/dashboard-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { DashboardHeader, type DashboardHeaderProps } from './dashboard-header.tsx';

const fns = vi.hoisted(() => ({ getDashboard: vi.fn() }));
vi.mock('../../server/fn/budget.ts', () => fns);
const record = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../ledger/record-transaction.tsx', () => ({ useRecordTransaction: () => record }));

function renderHeader(props: Partial<DashboardHeaderProps> = {}, options: { preferences?: object } = {}) {
  return renderApp(
    <DashboardHeader
      title="Selamat pagi, Avtara"
      description="Ini ringkasan uangmu periode 1–15 Oktober 2026."
      dashboard={dashboard()}
      periods={periodsOverview()}
      canRecord
      refreshing={false}
      {...props}
    />,
    options,
  );
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('DashboardHeader', () => {
  it('greets, switches the span by link, and records with N', async () => {
    const { screen } = await renderHeader();
    await expect.element(screen.getByRole('heading', { level: 1, name: 'Selamat pagi, Avtara' })).toBeVisible();
    const scopes = screen.getByRole('navigation', { name: 'Rentang ringkasan' });
    await expect.element(scopes.getByRole('link', { name: 'Minggu' })).toHaveAttribute('href', '/?scope=week');
    await expect.element(scopes.getByRole('link', { name: 'Bulan' })).toHaveAttribute('aria-current', 'page');
    await expect.element(scopes.getByRole('link', { name: 'Tahun' })).toHaveAttribute('href', '/?scope=year');
    await userEvent.click(screen.getByRole('button', { name: 'Catat Transaksi N' }));
    expect(record.open).toHaveBeenCalledOnce();
    expect(screen.getByRole('status').query()).toBeNull();
  });

  it('shows "Memperbarui ringkasan…" while another span loads, without pickers or recording when not ready', async () => {
    const { screen } = await renderHeader({ refreshing: true, dashboard: null, canRecord: false });
    await expect.element(screen.getByRole('status')).toMatchTextContent('Memperbarui ringkasan…');
    expect(screen.getByRole('button', { name: /Pilih periode/ }).query()).toBeNull();
    expect(screen.getByRole('button', { name: /Catat Transaksi/ }).query()).toBeNull();
    await expect.element(screen.getByRole('link', { name: 'Bulan' })).toHaveAttribute('aria-current', 'page');
  });

  it('picks a month of the year with its spending in millions', async () => {
    fns.getDashboard.mockImplementation(({ data }: { data: { year: number } }) =>
      Promise.resolve(
        data.year === 2026 ? { ok: true, value: yearDashboard() } : { ok: false, code: 'INVALID_PERIOD' },
      ),
    );
    const { screen, router } = await renderHeader();
    await userEvent.click(screen.getByRole('button', { name: 'Pilih periode: Okt 2026' }));
    const dialog = page.getByRole('dialog', { name: 'Pilih periode' });
    await expect.element(dialog.getByRole('button', { name: /^Sep/ })).toMatchTextContent('18,3');
    await expect.element(dialog.getByRole('button', { name: /^Okt/ })).toHaveAttribute('aria-current', 'page');
    await expect.element(dialog.getByRole('button', { name: /^Jan/ })).toBeDisabled();
    await expect.element(dialog.getByRole('button', { name: 'Tahun berikutnya' })).toBeDisabled();
    await userEvent.click(dialog.getByRole('button', { name: 'Tahun sebelumnya' }));
    await expect.element(dialog.getByText('2025')).toBeVisible();
    await userEvent.click(dialog.getByRole('button', { name: 'Tahun berikutnya' }));
    await expect.element(dialog.getByRole('button', { name: /^Sep/ })).toMatchTextContent('18,3');
    expect(fns.getDashboard).toHaveBeenCalledTimes(2);
    await userEvent.click(dialog.getByRole('button', { name: /^Sep/ }));
    expect(router.state.location.search).toEqual({ period: '2026-09' });
    await userEvent.click(screen.getByRole('button', { name: 'Pilih periode: Okt 2026' }));
    await userEvent.click(page.getByRole('button', { name: /^Okt/ }));
    expect(router.state.location.search).toEqual({});
    await userEvent.click(screen.getByRole('button', { name: 'Pilih periode: Okt 2026' }));
    await userEvent.click(page.getByRole('button', { name: /^Bulan lalu/ }));
    expect(router.state.location.search).toEqual({ period: '2026-09' });
    await userEvent.click(screen.getByRole('button', { name: 'Pilih periode: Okt 2026' }));
    await userEvent.click(page.getByRole('button', { name: /^Rentang khusus/ }));
    expect(router.state.location.search).toEqual({ range: '2026-10-01..2026-10-15' });
  });

  it('masks the millions in privacy mode and has no "Bulan lalu" without a past period', async () => {
    fns.getDashboard.mockResolvedValue({ ok: true, value: yearDashboard() });
    const { screen } = await renderHeader(
      { periods: periodsOverview({ periods: [periodsOverview().current] }) },
      { preferences: { balancesHidden: true } },
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pilih periode: Okt 2026' }));
    await expect.element(page.getByRole('button', { name: /^Okt/ })).toMatchTextContent('••');
    expect(page.getByRole('button', { name: /^Bulan lalu/ }).query()).toBeNull();
  });

  it('offers this and last week, and this and last year', async () => {
    const { screen, router } = await renderHeader({ dashboard: weekDashboard() });
    await userEvent.click(screen.getByRole('button', { name: 'Pilih periode: 12–18 Okt' }));
    await userEvent.click(page.getByRole('button', { name: /^Minggu lalu/ }));
    expect(router.state.location.search).toEqual({ range: '2026-10-05..2026-10-11' });
    await userEvent.click(screen.getByRole('button', { name: 'Pilih periode: 12–18 Okt' }));
    await userEvent.click(page.getByRole('button', { name: /^Minggu ini/ }));
    expect(router.state.location.search).toEqual({ scope: 'week' });
    const { screen: year, router: yearRouter } = await renderHeader({ dashboard: yearDashboard() });
    await userEvent.click(year.getByRole('button', { name: 'Pilih periode: 2026' }));
    expect(page.getByText('Angka kecil = total pengeluaran (juta)').query()).toBeNull();
    await userEvent.click(page.getByRole('button', { name: /^Tahun lalu/ }));
    expect(yearRouter.state.location.search).toEqual({ scope: 'year', year: 2025 });
    await userEvent.click(year.getByRole('button', { name: 'Pilih periode: 2026' }));
    await userEvent.click(page.getByRole('button', { name: /^Tahun ini/ }));
    expect(yearRouter.state.location.search).toEqual({ scope: 'year' });
    expect(fns.getDashboard).not.toHaveBeenCalled();
  });

  it('edits a custom range with "30 hari · melintasi 2 periode"', async () => {
    const { screen, router } = await renderHeader({
      dashboard: rangeDashboard(),
      periods: periodsOverview({ periods: [periodsOverview().current, SEPTEMBER] }),
    });
    const trigger = screen.getByRole('button', { name: /^Rentang khusus: / }).first();
    await userEvent.click(trigger);
    await expect.element(page.getByText('30 hari · melintasi 2 periode')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: /^Bulan lalu/ }));
    await userEvent.click(page.getByRole('button', { name: 'Terapkan' }));
    expect(router.state.location.search).toEqual({ range: '2026-09-01..2026-09-30' });
    const { screen: alone } = await renderHeader({
      dashboard: rangeDashboard(),
      periods: periodsOverview({ periods: [periodsOverview().current] }),
    });
    await userEvent.click(alone.getByRole('button', { name: /^Rentang khusus: / }).last());
    expect(page.getByRole('button', { name: /^Bulan lalu/ }).query()).toBeNull();
  });
});
