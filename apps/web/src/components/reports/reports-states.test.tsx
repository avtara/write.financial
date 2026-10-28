// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
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
  it('golden gyfhQ: the timeline to the closing month’s report, when it is published, and why', async () => {
    const { screen } = await renderApp(<ReportsEmpty today={TODAY} locale="id" onRecord={vi.fn()} />);
    const steps = screen.getByRole('listitem').elements();
    expect(steps.map((step) => step.textContent)).toEqual([
      '23 OktMulai mencatathari ini',
      '31 OktPeriode pertama ditutuptanggal mulai: 1',
      '1 NovLaporan Oktober terbitPDF & ringkasan',
    ]);
    await expect.element(screen.getByRole('heading', { name: 'Laporan pertama terbit 1 November' })).toBeVisible();
    await expect
      .element(
        screen.getByText(
          'Laporan dibuat setelah satu periode penuh tercatat. Periode Oktober berjalan 1–31 Okt; tanggal mulai periode bisa diubah di Pengaturan (maks. tanggal 28).',
        ),
      )
      .toBeVisible();
  });

  it('records a transaction and opens the period settings', async () => {
    const onRecord = vi.fn();
    const { screen, router } = await renderApp(<ReportsEmpty today={TODAY} locale="id" onRecord={onRecord} />);
    await screen.getByRole('button', { name: 'Catat transaksi' }).click();
    expect(onRecord).toHaveBeenCalledOnce();
    await screen.getByRole('button', { name: 'Atur tanggal mulai' }).click();
    await expect.poll(() => router.state.location.search as unknown).toMatchObject({ settings: 'period' });
  });

  it('keeps every step when the first day is also the closing day', async () => {
    const { screen } = await renderApp(
      <ReportsEmpty today={'2026-10-31' as LocalDate} locale="id" onRecord={vi.fn()} />,
    );
    expect(
      screen
        .getByRole('listitem')
        .elements()
        .map((step) => step.textContent.slice(0, 6)),
    ).toEqual(['31 Okt', '31 Okt', '1 NovL']);
  });

  it('switches to the English copy', async () => {
    const { screen } = await renderApp(<ReportsEmpty today={TODAY} locale="en" onRecord={vi.fn()} />, {
      preferences: { locale: 'en' },
    });
    const timeline = screen.getByRole('list');
    await expect.element(timeline).toMatchTextContent('Start recordingtoday');
    await expect.element(timeline).toMatchTextContent('The first period closesstart date: 1');
    await expect.element(timeline).toMatchTextContent('The October report is publishedPDF & summary');
    await expect
      .element(screen.getByRole('heading', { name: 'Your first report is published on November 1' }))
      .toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Record a transaction' })).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Set the start date' })).toBeVisible();
  });
});
