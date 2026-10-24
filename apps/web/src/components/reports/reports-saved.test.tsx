// SPDX-License-Identifier: AGPL-3.0-only
import type { ReportFileMeta } from '@wf/db/report-files';
import { describe, expect, it, vi } from 'vitest';
import { TODAY, summary } from '../../../test/report-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { SavedSection } from './reports-saved.tsx';

/** A stored export file row, as `listReportFiles` returns it. */
const file = (overrides: Partial<ReportFileMeta> = {}): ReportFileMeta => ({
  id: 'file-2026-09-pdf',
  reportId: 'report-2026-09',
  format: 'pdf',
  options: { sections: ['summary'], theme: 'light', paper: 'a4', maskAccountNumbers: false },
  fileKey: 'u/user/0199',
  sizeBytes: 1_240_000,
  createdAt: new Date('2026-10-01T02:00:00Z'),
  ...overrides,
});

describe('SavedSection', () => {
  it('lists the saved reports with status, range, and transaction count; openable rows are pressed buttons', async () => {
    const onSelect = vi.fn();
    const reports = [summary('2026-09'), summary('2026-08')];
    const { screen } = await renderApp(
      <SavedSection
        reports={reports}
        selectedId="report-2026-09"
        selectable={new Map([['report-2026-09', { kind: 'monthly', id: 'report-2026-09', periodId: 'period-sep' }]])}
        locale="id"
        today={TODAY}
        files={null}
        onSelect={onSelect}
      />,
    );
    const section = screen.getByRole('region', { name: 'Laporan tersimpan' });
    await expect.element(section).toMatchTextContent('Diunduh atau dikirim otomatis');
    await expect.element(section).toMatchTextContent('Final');
    await expect.element(section).toMatchTextContent('1–28 Sep');
    await expect.element(section).toMatchTextContent('121 transaksi');
    const open = screen.getByRole('button', { name: /2026-09/ });
    await expect.element(open).toHaveAttribute('aria-pressed', 'true');
    await open.click();
    expect(onSelect).toHaveBeenCalledWith({
      kind: 'monthly',
      id: 'report-2026-09',
      periodId: 'period-sep',
    });
  });

  it('keeps a report without a period id as static text', async () => {
    const onSelect = vi.fn();
    const { screen } = await renderApp(
      <SavedSection
        reports={[summary('2026-08')]}
        selectedId={null}
        selectable={new Map()}
        locale="id"
        today={TODAY}
        files={null}
        onSelect={onSelect}
      />,
    );
    await expect.element(screen.getByText('2026-08')).toBeVisible();
    expect(screen.getByRole('button', { name: /2026-08/ }).elements()).toHaveLength(0);
  });

  it('says so when nothing is saved', async () => {
    const onSelect = vi.fn();
    const { screen } = await renderApp(
      <SavedSection
        reports={[]}
        selectedId={null}
        selectable={new Map()}
        locale="id"
        today={TODAY}
        files={null}
        onSelect={onSelect}
      />,
    );
    await expect.element(screen.getByText('Belum ada laporan tersimpan.')).toBeVisible();
  });

  it('lists stored files with format, size, and date, each row a download of the named file', async () => {
    const { screen } = await renderApp(
      <SavedSection
        reports={[summary('2026-09')]}
        selectedId={null}
        selectable={new Map()}
        locale="id"
        today={TODAY}
        timeZone="Asia/Jakarta"
        files={[
          file(),
          file({ id: 'file-2026-08-csv', reportId: 'report-2026-08', format: 'csv', sizeBytes: 86_000 }),
          file({ id: 'file-orphan', reportId: 'report-gone', format: 'xlsx' }),
        ]}
        onSelect={vi.fn()}
      />,
    );
    // The newest file first, its name from the matching report, the size in Indonesian decimal commas.
    await expect.element(screen.getByText('Laporan-2026-09.pdf')).toBeVisible();
    await expect.element(screen.getByText('PDF · 1,2 MB · 1 Okt 2026, 09.00 WIB')).toBeVisible();
    // A file whose report is not in the saved list keeps a plain name.
    await expect.element(screen.getByText('Laporan.csv')).toBeVisible();
    await expect.element(screen.getByText('CSV · 86,0 kB · 1 Okt 2026, 09.00 WIB')).toBeVisible();
    await expect.element(screen.getByText('Laporan.xlsx')).toBeVisible();
    const links = document.querySelectorAll('a[download]');
    expect(links).toHaveLength(3);
    await expect.element(links[0] as HTMLElement).toHaveAttribute('href', '/api/reports/file-2026-09-pdf');
    await expect.element(links[0] as HTMLElement).toHaveAttribute('aria-label', 'Unduh Laporan-2026-09.pdf');
  });

  it('shows the files without a report row and then no empty text', async () => {
    const { screen } = await renderApp(
      <SavedSection
        reports={[]}
        selectedId={null}
        selectable={new Map()}
        locale="id"
        today={TODAY}
        timeZone="Asia/Jakarta"
        files={[file()]}
        onSelect={vi.fn()}
      />,
    );
    await expect.element(screen.getByText('Laporan.pdf')).toBeVisible();
    expect(screen.getByText('Belum ada laporan tersimpan.').elements()).toHaveLength(0);
  });

  it('keeps the empty text while the files list has not loaded', async () => {
    const { screen } = await renderApp(
      <SavedSection
        reports={[]}
        selectedId={null}
        selectable={new Map()}
        locale="id"
        today={TODAY}
        files={null}
        onSelect={vi.fn()}
      />,
    );
    await expect.element(screen.getByText('Belum ada laporan tersimpan.')).toBeVisible();
  });
});
