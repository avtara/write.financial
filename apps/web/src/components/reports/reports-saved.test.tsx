// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { TODAY, summary } from '../../../test/report-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { SavedSection } from './reports-saved.tsx';

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
        onSelect={onSelect}
      />,
    );
    await expect.element(screen.getByText('Belum ada laporan tersimpan.')).toBeVisible();
  });
});
