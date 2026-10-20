// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import { DashboardOffline, DashboardSetup, DashboardSkeleton, loadedAtLabel } from './dashboard-states.tsx';

describe('DashboardSetup', () => {
  it('starts at the account, the other steps waiting for one', async () => {
    const onRecord = vi.fn();
    const { screen } = await renderApp(
      <DashboardSetup hasAccount={false} hasTransaction={false} hasBudget={false} onRecord={onRecord} />,
    );
    const setup = screen.getByRole('region', { name: 'Siapkan write.financial dalam 3 langkah' });
    await expect.element(setup.getByText('0 / 3 selesai')).toBeVisible();
    await expect
      .element(setup.getByRole('link', { name: 'Tambah rekening' }))
      .toHaveAttribute('href', '/accounts?new=bank');
    await expect.element(setup.getByRole('button', { name: 'Catat transaksi' })).toBeDisabled();
    expect(setup.getByText('Butuh rekening dulu').elements()).toHaveLength(2);
    expect(setup.getByRole('link', { name: 'Atur anggaran' }).query()).toBeNull();
    await expect.element(screen.getByRole('heading', { name: 'Arus Uang' })).toBeVisible();
    await expect.element(screen.getByRole('heading', { name: 'Kalender Pengeluaran' })).toBeVisible();
    await expect.element(screen.getByRole('heading', { name: 'Langganan' })).toBeVisible();
  });

  it('marks finished steps and records from step 2', async () => {
    const onRecord = vi.fn();
    const { screen } = await renderApp(
      <DashboardSetup hasAccount hasTransaction={false} hasBudget onRecord={onRecord} />,
    );
    await expect.element(screen.getByText('2 / 3 selesai')).toBeVisible();
    expect(screen.getByText('Selesai').elements()).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Catat transaksi' }));
    expect(onRecord).toHaveBeenCalledOnce();
    const { screen: noBudget } = await renderApp(
      <DashboardSetup hasAccount hasTransaction={false} hasBudget={false} onRecord={onRecord} />,
    );
    await expect.element(noBudget.getByRole('link', { name: 'Atur anggaran' })).toHaveAttribute('href', '/budget');
  });
});

describe('DashboardSkeleton', () => {
  it('announces the loading', async () => {
    const { screen } = await renderApp(<DashboardSkeleton />);
    await expect.element(screen.getByRole('status', { name: 'Memuat ringkasan…' })).toBeInTheDocument();
  });
});

describe('DashboardOffline', () => {
  const at = new Date('2026-10-15T09:40:00Z');

  it('offers to retry and to see the last data', async () => {
    const onRetry = vi.fn();
    const onShowLast = vi.fn();
    const { screen } = await renderApp(
      <DashboardOffline
        lastLoadedAt={at}
        onRetry={onRetry}
        onShowLast={onShowLast}
        locale="id"
        timeZone="Asia/Jakarta"
      />,
    );
    const alert = screen.getByRole('alert');
    await expect.element(alert).toMatchTextContent('Kamu sedang offline');
    await expect.element(alert).toMatchTextContent('NETWORK_OFFLINE');
    await userEvent.click(alert.getByRole('button', { name: 'Coba lagi' }));
    await userEvent.click(alert.getByRole('button', { name: 'Lihat data terakhir · 15 Okt 16.40' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onShowLast).toHaveBeenCalledOnce();
  });

  it('has nothing to show before a first load', async () => {
    const { screen } = await renderApp(
      <DashboardOffline lastLoadedAt={null} onRetry={vi.fn()} onShowLast={vi.fn()} locale="en" timeZone="UTC" />,
      { preferences: { locale: 'en' } },
    );
    expect(screen.getByRole('button', { name: /See the last data/ }).query()).toBeNull();
    expect(loadedAtLabel(at, 'en', 'UTC')).toBe('Oct 15 09:40');
  });
});
