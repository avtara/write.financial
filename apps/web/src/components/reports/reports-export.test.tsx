// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { FINAL_VIEW } from '../../../test/report-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { ReportsExportDialog } from './reports-export.tsx';

const fake = vi.hoisted(() => ({
  requestReportExport: vi.fn(),
  getReportAutoSend: vi.fn(),
  saveReportAutoSend: vi.fn(),
}));
vi.mock('../../server/fn/report-export.ts', () => ({
  requestReportExport: fake.requestReportExport,
  getReportAutoSend: fake.getReportAutoSend,
  saveReportAutoSend: fake.saveReportAutoSend,
}));

/** Renders the dialog over the design's September view, with the auto-send answer queued. */
async function dialog() {
  return renderApp(<ReportsExportDialog view={FINAL_VIEW} locale="id" onOpenChange={vi.fn()} onExported={vi.fn()} />);
}

describe('ReportsExportDialog', () => {
  it('offers the design defaults and maps them into the request payload on submit', async () => {
    fake.requestReportExport.mockReset();
    fake.requestReportExport.mockResolvedValue({ ok: true, value: {} });
    fake.getReportAutoSend.mockReset();
    fake.getReportAutoSend.mockResolvedValue({ ok: false, code: 'UNAUTHENTICATED' });
    const onExported = vi.fn();
    const onOpenChange = vi.fn();
    const { screen } = await renderApp(
      <ReportsExportDialog view={FINAL_VIEW} locale="id" onOpenChange={onOpenChange} onExported={onExported} />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Ekspor laporan' });
    await expect.element(dialog).toBeVisible();
    await expect.element(screen.getByText('4 halaman · A4')).toBeVisible();
    // The period is the report being viewed, with its status.
    await expect.element(dialog).toMatchTextContent('2026-09');
    await expect.element(dialog).toMatchTextContent('Final');
    await screen.getByRole('button', { name: /Unduh/ }).click();
    expect(fake.requestReportExport).toHaveBeenCalledWith({
      data: {
        reportId: 'report-2026-09',
        format: 'pdf',
        options: {
          sections: ['summary', 'flow', 'spending', 'largest'],
          theme: 'light',
          paper: 'a4',
          maskAccountNumbers: false,
        },
      },
    });
    await expect.poll(() => onExported.mock.calls.length).toBe(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('counts the printed pages from the sections chosen and numbers them in order', async () => {
    fake.requestReportExport.mockReset();
    fake.requestReportExport.mockResolvedValue({ ok: true, value: {} });
    fake.getReportAutoSend.mockReset();
    fake.getReportAutoSend.mockResolvedValue({ ok: true, value: false });
    const { screen } = await dialog();
    const box = screen.getByRole('dialog', { name: 'Ekspor laporan' });
    await expect.element(screen.getByText('4 halaman · A4')).toBeVisible();
    await expect.element(box).toMatchTextContent('Arus uang & pemasukanhal. 2');
    // Unchecking "Ringkasan & kekayaan bersih" pulls the following pages forward.
    await screen.getByRole('checkbox', { name: /Ringkasan & kekayaan bersih/ }).click();
    await expect.element(screen.getByText('3 halaman · A4')).toBeVisible();
    await expect.element(box).toMatchTextContent('Arus uang & pemasukanhal. 1');
    await screen.getByRole('button', { name: /Unduh/ }).click();
    expect(fake.requestReportExport).toHaveBeenCalledWith({
      data: {
        reportId: 'report-2026-09',
        format: 'pdf',
        options: {
          sections: ['flow', 'spending', 'largest'],
          theme: 'light',
          paper: 'a4',
          maskAccountNumbers: false,
        },
      },
    });
  });

  it('switches format, appearance, paper, and masking into the payload, and drops PDF-only parts', async () => {
    fake.requestReportExport.mockReset();
    fake.requestReportExport.mockResolvedValue({ ok: true, value: {} });
    fake.getReportAutoSend.mockReset();
    fake.getReportAutoSend.mockResolvedValue({ ok: true, value: false });
    const { screen } = await dialog();
    await screen.getByRole('radio', { name: 'Excel' }).click();
    await expect.element(screen.getByText('Sheet per bulan')).toBeVisible();
    // The page count is a print (PDF) preview; Excel sheets have no pages.
    expect(screen.getByText('4 halaman · A4').elements()).toHaveLength(0);
    expect(screen.getByText('hal. 1').elements()).toHaveLength(0);
    await screen.getByRole('radio', { name: 'PDF' }).click();
    await screen.getByRole('radio', { name: 'Letter' }).click();
    await screen.getByRole('radio', { name: 'Gelap' }).click();
    await screen.getByRole('switch', { name: /Samarkan nomor rekening/ }).click();
    await expect.element(screen.getByText('4 halaman · Letter')).toBeVisible();
    await screen.getByRole('button', { name: /Unduh/ }).click();
    expect(fake.requestReportExport).toHaveBeenLastCalledWith({
      data: {
        reportId: 'report-2026-09',
        format: 'pdf',
        options: {
          sections: ['summary', 'flow', 'spending', 'largest'],
          theme: 'dark',
          paper: 'letter',
          maskAccountNumbers: true,
        },
      },
    });
  });

  it('re-checks a section back into print order, cancels, and survives a failed auto-send save', async () => {
    fake.requestReportExport.mockReset();
    fake.getReportAutoSend.mockReset();
    fake.getReportAutoSend.mockResolvedValue({ ok: true, value: false });
    fake.saveReportAutoSend.mockReset();
    fake.saveReportAutoSend.mockRejectedValue(new Error('offline'));
    const onOpenChange = vi.fn();
    const first = await renderApp(
      <ReportsExportDialog view={FINAL_VIEW} locale="id" onOpenChange={onOpenChange} onExported={vi.fn()} />,
    );
    const summary = first.screen.getByRole('checkbox', { name: /Ringkasan & kekayaan bersih/ });
    await summary.click();
    await summary.click();
    await expect.element(first.screen.getByText('4 halaman · A4')).toBeVisible();
    // A failed auto-send save only leaves the toggle as it was; the dialog stays usable.
    await first.screen.getByRole('switch', { name: /Kirim otomatis tiap tanggal 1/ }).click();
    // A refused save (ok:false) equally keeps the optimistic state without an error.
    fake.saveReportAutoSend.mockReset();
    fake.saveReportAutoSend.mockResolvedValue({ ok: false, code: 'UNAUTHENTICATED' });
    await first.screen.getByRole('switch', { name: /Kirim otomatis tiap tanggal 1/ }).click();
    await first.screen.getByRole('button', { name: 'Batal' }).click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await first.screen.unmount();

    // A rejected preference read leaves the toggle disabled (unknown state), never a crash.
    fake.getReportAutoSend.mockReset();
    fake.getReportAutoSend.mockRejectedValue(new Error('offline'));
    const second = await renderApp(
      <ReportsExportDialog view={FINAL_VIEW} locale="id" onOpenChange={vi.fn()} onExported={vi.fn()} />,
    );
    await expect.element(second.screen.getByRole('switch', { name: /Kirim otomatis tiap tanggal 1/ })).toBeDisabled();
    await second.screen.unmount();
  });

  it('explains a refused export with the ledger words and keeps the dialog open', async () => {
    fake.requestReportExport.mockReset();
    fake.requestReportExport.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
    fake.getReportAutoSend.mockReset();
    fake.getReportAutoSend.mockResolvedValue({ ok: true, value: false });
    const onOpenChange = vi.fn();
    const onExported = vi.fn();
    const { screen } = await renderApp(
      <ReportsExportDialog view={FINAL_VIEW} locale="id" onOpenChange={onOpenChange} onExported={onExported} />,
    );
    await screen.getByRole('button', { name: /Unduh/ }).click();
    await expect.element(screen.getByText('Data ini sudah tidak ada. Muat ulang halaman.')).toBeVisible();
    expect(onExported).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('loads the auto-send state while opening and persists every change of the toggle', async () => {
    fake.requestReportExport.mockReset();
    fake.getReportAutoSend.mockReset();
    fake.getReportAutoSend.mockResolvedValue({ ok: true, value: true });
    fake.saveReportAutoSend.mockReset();
    fake.saveReportAutoSend.mockResolvedValue({ ok: true, value: false });
    const { screen } = await dialog();
    const autoSend = screen.getByRole('switch', { name: /Kirim otomatis tiap tanggal 1/ });
    await expect.element(autoSend).toBeChecked();
    await autoSend.click();
    expect(fake.saveReportAutoSend).toHaveBeenCalledWith({ data: { enabled: false } });
    // The answer confirms the optimistic state.
    await expect.element(autoSend).not.toBeChecked();
  });
});
