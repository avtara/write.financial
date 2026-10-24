// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { ReportSummary, ReportView } from '@wf/db/reports';
import { CUSTOM_VIEW, FINAL_VIEW, PROVISIONAL_VIEW, TODAY, summary } from '../../../test/report-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { ReportsPage } from './reports-page.tsx';

const fake = vi.hoisted(() => ({
  viewReport: vi.fn(),
  listReportFiles: vi.fn(),
  requestReportExport: vi.fn(),
  getReportAutoSend: vi.fn(),
  saveReportAutoSend: vi.fn(),
}));
vi.mock('../../server/fn/reports.ts', () => ({
  viewReport: fake.viewReport,
  getReportsHome: vi.fn(),
}));
vi.mock('../../server/fn/report-export.ts', () => ({
  listReportFiles: fake.listReportFiles,
  requestReportExport: fake.requestReportExport,
  getReportAutoSend: fake.getReportAutoSend,
  saveReportAutoSend: fake.saveReportAutoSend,
}));

const YEARLY_VIEW = { ...PROVISIONAL_VIEW, id: 'report-2026', kind: 'yearly', label: '2026' } as const;
const deferred = () => {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((res) => {
    resolve = res;
  });
  return { promise: promise as Promise<{ ok: boolean; value: ReportView }>, resolve };
};

describe('ReportsPage', () => {
  beforeEach(() => {
    fake.listReportFiles.mockReset();
    fake.listReportFiles.mockResolvedValue({ ok: true, value: [] });
    // The export dialog reads the auto-send preference while it opens; the page tests never open it.
    fake.getReportAutoSend.mockReset();
    fake.getReportAutoSend.mockResolvedValue({ ok: false, code: 'UNAUTHENTICATED' });
  });

  it('fetches the stored export files on mount and shows them in the saved section', async () => {
    fake.viewReport.mockReset();
    fake.listReportFiles.mockResolvedValue({
      ok: true,
      value: [
        {
          id: 'file-1',
          reportId: 'report-2026-09',
          format: 'pdf',
          options: { sections: ['summary'], theme: 'light', paper: 'a4', maskAccountNumbers: false },
          fileKey: 'u/u/0',
          sizeBytes: 1240,
          createdAt: new Date('2026-10-01T02:00:00Z'),
        },
      ],
    });
    const { screen } = await renderApp(
      <ReportsPage
        reports={[summary('2026-09')]}
        latestFinal={FINAL_VIEW}
        today={TODAY}
        timeZone="Asia/Jakarta"
        locale="id"
      />,
    );
    await expect.poll(() => fake.listReportFiles.mock.calls.length).toBe(1);
    await expect.element(screen.getByText('Laporan-2026-09.pdf')).toBeVisible();
  });

  it('opens the export dialog over the viewed report from the header button', async () => {
    fake.viewReport.mockReset();
    const { screen } = await renderApp(
      <ReportsPage
        reports={[summary('2026-09')]}
        latestFinal={FINAL_VIEW}
        today={TODAY}
        timeZone="Asia/Jakarta"
        locale="id"
      />,
    );
    await screen.getByRole('button', { name: /Ekspor laporan/ }).click();
    await expect.element(screen.getByRole('dialog', { name: 'Ekspor laporan' })).toBeVisible();
    await expect.element(screen.getByText('4 halaman · A4')).toBeVisible();
  });

  it('offers no export button while nothing is viewed', async () => {
    fake.viewReport.mockReset();
    const { screen } = await renderApp(
      <ReportsPage reports={[]} latestFinal={null} today={TODAY} timeZone="Asia/Jakarta" locale="id" />,
    );
    await expect.element(screen.getByText('Laporan pertamamu sedang menunggu periode pertama')).toBeVisible();
    expect(screen.getByRole('button', { name: /Ekspor laporan/ }).elements()).toHaveLength(0);
  });

  it('opens the latest final report on the first render without a fetch', async () => {
    fake.viewReport.mockReset();
    const { screen } = await renderApp(
      <ReportsPage
        reports={[summary('2026-09'), summary('2026-08')]}
        latestFinal={FINAL_VIEW}
        today={TODAY}
        timeZone="Asia/Jakarta"
        locale="id"
      />,
    );
    const header = screen.getByRole('banner');
    await expect.element(header).toMatchTextContent('September 2026');
    await expect.element(header).toMatchTextContent('Final');
    await expect.element(header).toMatchTextContent('1–30 Sep');
    await expect.element(header).toMatchTextContent('dibandingkan dengan Agustus 2026');
    await expect.element(header).toMatchTextContent('121 transaksi');
    await expect.element(header).toMatchTextContent('Dibuat 1 Okt 2026');
    await expect.element(screen.getByText('Laporan lama tidak berubah')).toBeVisible();
    await expect.element(screen.getByRole('group', { name: 'Pemasukan' })).toMatchTextContent('Rp25.800.000');
    expect(fake.viewReport).not.toHaveBeenCalled();
  });

  it('localizes the header line to English', async () => {
    fake.viewReport.mockReset();
    const { screen } = await renderApp(
      <ReportsPage reports={[]} latestFinal={FINAL_VIEW} today={TODAY} timeZone="Asia/Jakarta" locale="en" />,
      { preferences: { locale: 'en' } },
    );
    const header = screen.getByRole('banner');
    await expect.element(header).toMatchTextContent('September 2026');
    await expect.element(header).toMatchTextContent('compared with August 2026');
    await expect.element(header).toMatchTextContent('121 transactions');
  });

  it('recalculates into a provisional quarter, keeping the old data on screen while pending', async () => {
    fake.viewReport.mockReset();
    const slow = deferred();
    fake.viewReport.mockReturnValueOnce(slow.promise);
    const { screen } = await renderApp(
      <ReportsPage
        reports={[summary('2026-09')]}
        latestFinal={FINAL_VIEW}
        today={TODAY}
        timeZone="Asia/Jakarta"
        locale="id"
      />,
    );
    await screen.getByRole('button', { name: 'Kuartal' }).click();
    await screen.getByRole('button', { name: 'Q3 2026' }).click();
    expect(fake.viewReport).toHaveBeenCalledWith({ data: { kind: 'quarterly', year: 2026, quarter: 3 } });
    await expect.element(screen.getByText('Menghitung ulang…')).toBeVisible();
    await expect.element(screen.getByRole('group', { name: 'Pemasukan' })).toMatchTextContent('Rp25.800.000');
    slow.resolve({ ok: true, value: PROVISIONAL_VIEW });
    await expect.element(screen.getByText('Sementara')).toBeVisible();
    expect(screen.getByText('Laporan lama tidak berubah').elements()).toHaveLength(0);
    await expect.element(screen.getByRole('group', { name: 'Pemasukan' })).toMatchTextContent('Rp70.000.000');
  });

  it('shows the error state with retry, then recovers', async () => {
    fake.viewReport.mockReset();
    fake.viewReport
      .mockResolvedValueOnce({ ok: false, code: 'INVALID_PERIOD' })
      .mockResolvedValueOnce({ ok: true, value: PROVISIONAL_VIEW });
    const { screen } = await renderApp(
      <ReportsPage
        reports={[summary('2026-09')]}
        latestFinal={FINAL_VIEW}
        today={TODAY}
        timeZone="Asia/Jakarta"
        locale="id"
      />,
    );
    await screen.getByRole('button', { name: 'Kuartal' }).click();
    await screen.getByRole('button', { name: 'Q3 2026' }).click();
    await expect.element(screen.getByRole('alert')).toMatchTextContent('Laporan Q3 2026 gagal disusun');
    await screen.getByRole('button', { name: 'Coba lagi' }).click();
    expect(fake.viewReport).toHaveBeenNthCalledWith(2, { data: { kind: 'quarterly', year: 2026, quarter: 3 } });
    await expect.element(screen.getByText('Sementara')).toBeVisible();
  });

  it('reports a network failure the same way', async () => {
    fake.viewReport.mockReset();
    fake.viewReport.mockRejectedValueOnce(new Error('offline'));
    const { screen } = await renderApp(
      <ReportsPage
        reports={[summary('2026-09')]}
        latestFinal={FINAL_VIEW}
        today={TODAY}
        timeZone="Asia/Jakarta"
        locale="id"
      />,
    );
    await screen.getByRole('button', { name: 'Tahunan' }).click();
    await screen.getByRole('button', { name: '2026' }).click();
    expect(fake.viewReport).toHaveBeenCalledWith({ data: { kind: 'yearly', year: 2026 } });
    await expect.element(screen.getByRole('alert')).toMatchTextContent('Laporan 2026 gagal disusun');
  });

  it('ignores a stale response when another selection already superseded it', async () => {
    fake.viewReport.mockReset();
    const slow = deferred();
    fake.viewReport.mockReturnValueOnce(slow.promise).mockResolvedValueOnce({ ok: true, value: YEARLY_VIEW });
    const { screen } = await renderApp(
      <ReportsPage
        reports={[summary('2026-09')]}
        latestFinal={FINAL_VIEW}
        today={TODAY}
        timeZone="Asia/Jakarta"
        locale="id"
      />,
    );
    await screen.getByRole('button', { name: 'Kuartal' }).click();
    await screen.getByRole('button', { name: 'Q3 2026' }).click();
    await screen.getByRole('button', { name: 'Tahunan' }).click();
    await screen.getByRole('button', { name: '2026' }).click();
    expect(screen.getByText('Menghitung ulang…').elements()).toHaveLength(0);
    await expect.element(screen.getByText('Sementara')).toBeVisible();
    slow.resolve({ ok: true, value: PROVISIONAL_VIEW });
    const header = screen.getByRole('banner');
    await expect.element(header).toMatchTextContent('2026');
    await expect.element(header).not.toMatchTextContent('Q3');
  });

  it('applies a custom range', async () => {
    fake.viewReport.mockReset();
    fake.viewReport.mockResolvedValueOnce({ ok: true, value: CUSTOM_VIEW });
    const { screen } = await renderApp(
      <ReportsPage
        reports={[summary('2026-09')]}
        latestFinal={FINAL_VIEW}
        today={TODAY}
        timeZone="Asia/Jakarta"
        locale="id"
      />,
    );
    await screen.getByRole('button', { name: 'Kustom' }).click();
    const inputs = document.querySelectorAll('input[type="date"]');
    await userEvent.fill(inputs[0] as HTMLInputElement, '2026-10-01');
    await userEvent.fill(inputs[1] as HTMLInputElement, '2026-10-15');
    await screen.getByRole('button', { name: 'Terapkan' }).click();
    expect(fake.viewReport).toHaveBeenCalledWith({ data: { kind: 'custom', from: '2026-10-01', to: '2026-10-15' } });
    await expect.element(screen.getByRole('banner')).toMatchTextContent('1–15 Okt');
    await expect.element(screen.getByText('Sementara')).toBeVisible();
  });

  it('shows the empty timeline for a new user, without a picker or fetch', async () => {
    fake.viewReport.mockReset();
    const { screen } = await renderApp(
      <ReportsPage reports={[]} latestFinal={null} today={TODAY} timeZone="Asia/Jakarta" locale="id" />,
    );
    await expect.element(screen.getByText('Laporan pertamamu sedang menunggu periode pertama')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Kuartal' }).elements()).toHaveLength(0);
    expect(fake.viewReport).not.toHaveBeenCalled();
  });

  it('opens the newest saved month on mount when no final report exists', async () => {
    fake.viewReport.mockReset();
    fake.viewReport.mockResolvedValueOnce({ ok: true, value: FINAL_VIEW });
    const enriched = { ...summary('2026-09'), periodId: 'period-sep' } as ReportSummary;
    const { screen } = await renderApp(
      <ReportsPage reports={[enriched]} latestFinal={null} today={TODAY} timeZone="Asia/Jakarta" locale="id" />,
    );
    await expect.poll(() => fake.viewReport.mock.calls.length).toBe(1);
    expect(fake.viewReport).toHaveBeenCalledWith({ data: { kind: 'monthly', periodId: 'period-sep' } });
    await expect.element(screen.getByRole('banner').getByText('Final')).toBeVisible();
  });

  it('opens a final report whose period id row is corrupt without fetching', async () => {
    fake.viewReport.mockReset();
    const { screen } = await renderApp(
      <ReportsPage
        reports={[]}
        latestFinal={{ ...FINAL_VIEW, periodId: null }}
        today={TODAY}
        timeZone="Asia/Jakarta"
        locale="id"
      />,
    );
    const header = screen.getByRole('banner');
    await expect.element(header).toMatchTextContent('September 2026');
    expect(fake.viewReport).not.toHaveBeenCalled();
  });

  it('keeps compiling when the newest saved month has no fetchable period id yet', async () => {
    fake.viewReport.mockReset();
    const stale = { ...summary('2026-09'), periodId: null } as ReportSummary;
    const { screen } = await renderApp(
      <ReportsPage reports={[stale]} latestFinal={null} today={TODAY} timeZone="Asia/Jakarta" locale="id" />,
    );
    await expect.element(screen.getByText('Menyusun laporan…')).toBeVisible();
    expect(fake.viewReport).not.toHaveBeenCalled();
  });

  it('keeps compiling when the newest saved report is not a month', async () => {
    fake.viewReport.mockReset();
    const { screen } = await renderApp(
      <ReportsPage
        reports={[summary('2026-Q3', { kind: 'quarterly' })]}
        latestFinal={null}
        today={TODAY}
        timeZone="Asia/Jakarta"
        locale="id"
      />,
    );
    await expect.element(screen.getByText('Menyusun laporan…')).toBeVisible();
    expect(fake.viewReport).not.toHaveBeenCalled();
  });

  it('opens a saved report from the list through its period id', async () => {
    fake.viewReport.mockReset();
    fake.viewReport.mockResolvedValueOnce({ ok: true, value: FINAL_VIEW });
    const { screen } = await renderApp(
      <ReportsPage
        reports={[summary('2026-09')]}
        latestFinal={FINAL_VIEW}
        today={TODAY}
        timeZone="Asia/Jakarta"
        locale="id"
      />,
    );
    await screen.getByRole('button', { name: /2026-09/ }).click();
    expect(fake.viewReport).toHaveBeenCalledWith({ data: { kind: 'monthly', periodId: 'period-sep' } });
  });
});
