// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { FINAL_VIEW, TODAY, summary } from '../../../test/report-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { ReportsPicker } from './reports-picker.tsx';
import type { ReportSelection } from './reports-model.ts';

describe('ReportsPicker', () => {
  it('lists the saved months as buttons; the selected one is pressed and each opens through its period id', async () => {
    const onSelect = vi.fn();
    const selection: ReportSelection = { kind: 'monthly', id: FINAL_VIEW.id, periodId: 'period-sep' };
    const { screen } = await renderApp(
      <ReportsPicker
        reports={[summary('2026-09'), summary('2026-08')]}
        latestFinal={FINAL_VIEW}
        today={TODAY}
        locale="id"
        selection={selection}
        onSelect={onSelect}
      />,
    );
    await expect.element(screen.getByText('Laporan final tersedia s.d. September 2026')).toBeVisible();
    const open = screen.getByRole('button', { name: 'September 2026' });
    await expect.element(open).toHaveAttribute('aria-pressed', 'true');
    await open.click();
    expect(onSelect).toHaveBeenCalledWith({ kind: 'monthly', id: 'report-2026-09', periodId: 'period-sep' });
    await screen.getByRole('button', { name: 'Agustus 2026' }).click();
    expect(onSelect).toHaveBeenLastCalledWith({ kind: 'monthly', id: 'report-2026-08', periodId: 'period-2026-08' });
    await expect.element(screen.getByText('Agustus 2026')).toBeVisible();
  });

  it('switches to the quarters that already ended and reports the selection', async () => {
    const onSelect = vi.fn();
    const { screen } = await renderApp(
      <ReportsPicker reports={[]} latestFinal={null} today={TODAY} locale="id" selection={null} onSelect={onSelect} />,
    );
    await screen.getByRole('button', { name: 'Kuartal' }).click();
    const group = screen.getByRole('group', { name: 'Kuartal' });
    await expect.element(group).toMatchTextContent('Q3 2026');
    await expect.element(group).toMatchTextContent('Q4 2025');
    await expect.element(group).not.toMatchTextContent('Q4 2026');
    await screen.getByRole('button', { name: /Q3 2026/ }).click();
    expect(onSelect).toHaveBeenCalledWith({ kind: 'quarterly', year: 2026, quarter: 3 });
  });

  it('offers this year and the previous one', async () => {
    const onSelect = vi.fn();
    const { screen } = await renderApp(
      <ReportsPicker reports={[]} latestFinal={null} today={TODAY} locale="id" selection={null} onSelect={onSelect} />,
    );
    await screen.getByRole('button', { name: 'Tahunan' }).click();
    await screen.getByRole('button', { name: '2026' }).click();
    expect(onSelect).toHaveBeenCalledWith({ kind: 'yearly', year: 2026 });
    await screen.getByRole('button', { name: '2025' }).click();
    expect(onSelect).toHaveBeenCalledWith({ kind: 'yearly', year: 2025 });
  });

  it('applies a valid custom range and refuses an inverted one', async () => {
    const onSelect = vi.fn();
    const { screen } = await renderApp(
      <ReportsPicker reports={[]} latestFinal={null} today={TODAY} locale="id" selection={null} onSelect={onSelect} />,
    );
    await screen.getByRole('button', { name: 'Kustom' }).click();
    const apply = screen.getByRole('button', { name: 'Terapkan' });
    await expect.element(apply).toBeDisabled();
    const inputs = document.querySelectorAll('input[type="date"]');
    await userEvent.fill(inputs[0] as HTMLInputElement, '2026-10-15');
    await userEvent.fill(inputs[1] as HTMLInputElement, '2026-10-01');
    await expect.element(screen.getByText('Tanggal akhir tidak boleh sebelum tanggal awal.')).toBeVisible();
    await expect.element(apply).toBeDisabled();
    await userEvent.fill(inputs[0] as HTMLInputElement, '2026-10-01');
    await userEvent.fill(inputs[1] as HTMLInputElement, '2026-10-15');
    await expect.element(apply).toBeEnabled();
    await apply.click();
    expect(onSelect).toHaveBeenCalledWith({ kind: 'custom', from: '2026-10-01', to: '2026-10-15' });
  });

  it('does not select an inverted range submitted from the inputs', async () => {
    const onSelect = vi.fn();
    const { screen } = await renderApp(
      <ReportsPicker reports={[]} latestFinal={null} today={TODAY} locale="id" selection={null} onSelect={onSelect} />,
    );
    await screen.getByRole('button', { name: 'Kustom' }).click();
    const inputs = document.querySelectorAll('input[type="date"]');
    await userEvent.fill(inputs[0] as HTMLInputElement, '2026-10-15');
    await userEvent.fill(inputs[1] as HTMLInputElement, '2026-10-01');
    await userEvent.keyboard('{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows no final caption without a latest final report', async () => {
    const onSelect = vi.fn();
    const { screen } = await renderApp(
      <ReportsPicker reports={[]} latestFinal={null} today={TODAY} locale="id" selection={null} onSelect={onSelect} />,
    );
    expect(screen.getByText('Laporan final tersedia s.d. September 2026').elements()).toHaveLength(0);
  });
});
