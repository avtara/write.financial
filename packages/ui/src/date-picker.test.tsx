// SPDX-License-Identifier: AGPL-3.0-only
import { parseLocalDate as d, type LocalDate } from '@wf/domain/period';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { DatePicker, type DatePickerProps } from './date-picker.tsx';

const LABELS = { previousMonth: 'Bulan sebelumnya', nextMonth: 'Bulan berikutnya' };
const TODAY = d('2026-10-15');
const PRESETS = [
  { label: 'Hari ini', date: TODAY },
  { label: 'Kemarin', date: d('2026-10-14') },
];

type HarnessProps = Partial<Omit<DatePickerProps, 'value'>> & { initial?: LocalDate | null };

function Harness({ initial = null, onValueChange, ...props }: HarnessProps) {
  const [value, setValue] = useState<LocalDate | null>(initial);
  return (
    <DatePicker
      value={value}
      onValueChange={(date) => {
        onValueChange?.(date);
        setValue(date);
      }}
      placeholder="Pilih tanggal"
      today={TODAY}
      locale="id"
      labels={LABELS}
      aria-label="Tanggal"
      {...props}
    />
  );
}

describe('DatePicker', () => {
  it('shows the placeholder, then the chosen day, and returns focus to the trigger', async () => {
    const onValueChange = vi.fn();
    const screen = await render(<Harness onValueChange={onValueChange} />);
    const trigger = screen.getByRole('button', { name: 'Tanggal' });
    await expect.element(trigger).toHaveTextContent('Pilih tanggal');
    await userEvent.click(trigger);
    await expect.element(page.getByRole('dialog')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Senin, 12 Oktober 2026', exact: true }));
    expect(onValueChange).toHaveBeenCalledWith('2026-10-12');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await expect.element(trigger).toHaveTextContent('12 Okt 2026');
    await expect.element(trigger).toHaveFocus();
  });

  it('opens on the month of the value and picks presets, marking the current one', async () => {
    const onValueChange = vi.fn();
    const screen = await render(<Harness initial={d('2026-08-03')} onValueChange={onValueChange} presets={PRESETS} />);
    await userEvent.click(screen.getByRole('button', { name: 'Tanggal' }));
    await expect.element(page.getByRole('grid', { name: 'Agustus 2026' })).toBeVisible();
    const today = page.getByRole('button', { name: /^Hari ini/ });
    await expect.element(today).toHaveTextContent('Hari ini15 Okt');
    await expect.element(today).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(today);
    expect(onValueChange).toHaveBeenCalledWith('2026-10-15');
    await userEvent.click(screen.getByRole('button', { name: 'Tanggal' }));
    await expect.element(page.getByRole('button', { name: /^Hari ini/ })).toHaveAttribute('aria-pressed', 'true');
    await expect.element(page.getByRole('grid', { name: 'Oktober 2026' })).toBeVisible();
  });

  it('opens on the current month without a value, and shows the extra slots', async () => {
    const screen = await render(
      <Harness
        presetsFooter={<button type="button">Jadwalkan</button>}
        footer={<span>ada transaksi</span>}
        isMarked={(date) => date === TODAY}
        markerLabel="ada transaksi"
        disableFuture
        weekStartsOn={0}
        size="sm"
        id="tanggal"
        aria-describedby="hint"
        aria-invalid
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Tanggal' });
    await expect.element(trigger).toHaveAttribute('id', 'tanggal');
    await expect.element(trigger).toHaveAttribute('aria-invalid', 'true');
    await expect.element(trigger).toHaveAttribute('aria-describedby', 'hint');
    await userEvent.click(trigger);
    await expect.element(page.getByRole('grid', { name: 'Oktober 2026' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Jadwalkan' })).toBeVisible();
    await expect.element(page.getByText('ada transaksi', { exact: true })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Kamis, 15 Oktober 2026, ada transaksi' })).toBeVisible();
    await expect
      .element(page.getByRole('button', { name: 'Jumat, 16 Oktober 2026' }))
      .toHaveAttribute('aria-disabled', 'true');
    expect(page.getByRole('columnheader').elements()[0]?.textContent).toBe('Min');
  });

  it('closes on Escape without choosing', async () => {
    const onValueChange = vi.fn();
    const screen = await render(<Harness onValueChange={onValueChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Tanggal' }));
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
