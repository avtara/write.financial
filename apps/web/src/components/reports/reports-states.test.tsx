// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { TODAY } from '../../../test/report-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { ImmutabilityBanner, ReportsEmpty, ReportsError, StatusBadge } from './reports-states.tsx';

describe('StatusBadge', () => {
  it('marks a final report green and a provisional one amber, in both locales', async () => {
    const { screen } = await renderApp(<StatusBadge status="final" />, { preferences: { locale: 'id' } });
    await expect.element(screen.getByText('Final')).toBeVisible();
    const en = await renderApp(<StatusBadge status="provisional" />, { preferences: { locale: 'en' } });
    await expect.element(en.screen.getByText('Provisional')).toBeVisible();
  });

  it('reads "Sementara" in Indonesian', async () => {
    const { screen } = await renderApp(<StatusBadge status="provisional" />, { preferences: { locale: 'id' } });
    await expect.element(screen.getByText('Sementara')).toBeVisible();
  });
});

describe('ImmutabilityBanner', () => {
  it('explains that past reports never change', async () => {
    const { screen } = await renderApp(<ImmutabilityBanner />);
    await expect.element(screen.getByText('Laporan lama tidak berubah')).toBeVisible();
  });
});

describe('ReportsError', () => {
  it('names the failed report and retries on demand', async () => {
    const onRetry = vi.fn();
    const { screen } = await renderApp(<ReportsError label="Q3 2026" onRetry={onRetry} />);
    const alert = screen.getByRole('alert');
    await expect.element(alert).toMatchTextContent('Laporan Q3 2026 gagal disusun');
    await screen.getByRole('button', { name: 'Coba lagi' }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('uses the English copy', async () => {
    const onRetry = vi.fn();
    const { screen } = await renderApp(<ReportsError label="Q3 2026" onRetry={onRetry} />, {
      preferences: { locale: 'en' },
    });
    await expect.element(screen.getByRole('alert')).toMatchTextContent('The Q3 2026 report failed to compile');
    await screen.getByRole('button', { name: 'Try again' }).click();
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('ReportsEmpty', () => {
  it('shows the timeline up to the first report and links to the ledger', async () => {
    const { screen } = await renderApp(<ReportsEmpty today={TODAY} locale="id" />);
    const timeline = screen.getByRole('list');
    await expect.element(timeline).toMatchTextContent('23 Okt');
    await expect.element(timeline).toMatchTextContent('Mulai mencatat');
    await expect.element(timeline).toMatchTextContent('31 Okt');
    await expect.element(timeline).toMatchTextContent('Periode pertama ditutup');
    await expect.element(timeline).toMatchTextContent('1 Nov');
    await expect.element(timeline).toMatchTextContent('Laporan November terbit');
    await expect.element(screen.getByText('Laporan pertamamu sedang menunggu periode pertama')).toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Catat transaksi' }))
      .toHaveAttribute('href', '/transactions');
  });

  it('opens the period settings from "Atur tanggal mulai"', async () => {
    const { screen, router } = await renderApp(<ReportsEmpty today={TODAY} locale="id" />);
    await screen.getByRole('button', { name: 'Atur tanggal mulai' }).click();
    await expect.poll(() => router.state.location.search as unknown).toMatchObject({ settings: 'period' });
  });

  it('switches to the English copy', async () => {
    const { screen } = await renderApp(<ReportsEmpty today={TODAY} locale="en" />, {
      preferences: { locale: 'en' },
    });
    const timeline = screen.getByRole('list');
    await expect.element(timeline).toMatchTextContent('Start recording');
    await expect.element(timeline).toMatchTextContent('The first period closes');
    await expect.element(timeline).toMatchTextContent('The November report is published');
    await expect.element(screen.getByRole('link', { name: 'Record a transaction' })).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Set the start date' })).toBeVisible();
  });
});
