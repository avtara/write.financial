// SPDX-License-Identifier: AGPL-3.0-only
import { countDays, parseLocalDate as d } from '@wf/domain/period';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import type { DateRange } from './dates.ts';
import { RangePicker, type RangePickerProps } from './range-picker.tsx';

const TODAY = d('2026-10-15');
const LABELS = {
  previousMonth: 'Bulan sebelumnya',
  nextMonth: 'Bulan berikutnya',
  start: 'Mulai',
  end: 'Selesai',
  apply: 'Terapkan',
  cancel: 'Batal',
};
const PRESETS = [
  { label: '7 hari terakhir', range: { start: d('2026-10-09'), end: TODAY } },
  { label: 'Bulan lalu', range: { start: d('2026-09-01'), end: d('2026-09-30') } },
];

function Harness({ onValueChange, ...props }: Partial<RangePickerProps>) {
  const [value, setValue] = useState<DateRange>({ start: d('2026-10-12'), end: TODAY });
  return (
    <RangePicker
      value={value}
      onValueChange={(range) => {
        onValueChange?.(range);
        setValue(range);
      }}
      presets={PRESETS}
      summary={(range) => `${countDays(range.start, range.end)} hari`}
      today={TODAY}
      locale="id"
      labels={LABELS}
      aria-label="Rentang tanggal"
      {...props}
    />
  );
}

const day = (name: string) => page.getByRole('button', { name, exact: true });

async function open() {
  await userEvent.click(page.getByRole('button', { name: /^Rentang tanggal/ }));
  await expect.element(page.getByRole('dialog')).toBeVisible();
}

describe('RangePicker', () => {
  it('names the trigger with the range and shows two months ending with the range', async () => {
    await render(<Harness />);
    await expect
      .element(page.getByRole('button', { name: 'Rentang tanggal: 12–15 Okt' }))
      .toHaveTextContent('12–15 Okt');
    await open();
    await expect.element(page.getByRole('grid', { name: 'September 2026' })).toBeVisible();
    await expect.element(page.getByRole('grid', { name: 'Oktober 2026' })).toBeVisible();
    await expect.element(page.getByLabelText('Mulai')).toHaveValue('2026-10-12');
    await expect.element(page.getByLabelText('Selesai')).toHaveValue('2026-10-15');
    await expect.element(page.getByLabelText('Selesai')).toHaveAttribute('max', '2026-10-15');
    await expect.element(page.getByText('4 hari')).toBeVisible();
  });

  it('chooses a range with two clicks in either order and applies it', async () => {
    const onValueChange = vi.fn();
    await render(<Harness onValueChange={onValueChange} />);
    await open();
    await userEvent.click(day('Kamis, 8 Oktober 2026'));
    await expect.element(page.getByLabelText('Selesai')).toHaveValue('');
    await expect.element(page.getByText('1 hari')).toBeVisible();
    await userEvent.click(day('Kamis, 24 September 2026'));
    await expect.element(page.getByText('15 hari')).toBeVisible();
    await userEvent.click(day('Sabtu, 26 September 2026'));
    await userEvent.click(day('Senin, 28 September 2026'));
    await userEvent.click(page.getByRole('button', { name: 'Terapkan' }));
    expect(onValueChange).toHaveBeenCalledWith({ start: '2026-09-26', end: '2026-09-28' });
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await expect.element(page.getByRole('button', { name: /^Rentang tanggal/ })).toHaveTextContent('26–28 Sep');
  });

  it('applies a single day after one click', async () => {
    const onValueChange = vi.fn();
    await render(<Harness onValueChange={onValueChange} />);
    await open();
    await userEvent.click(day('Kamis, 8 Oktober 2026'));
    await userEvent.click(page.getByRole('button', { name: 'Terapkan' }));
    expect(onValueChange).toHaveBeenCalledWith({ start: '2026-10-08', end: '2026-10-08' });
  });

  it('takes presets and typed dates, swapping a reversed range', async () => {
    const onValueChange = vi.fn();
    await render(<Harness onValueChange={onValueChange} />);
    await open();
    const lastMonth = page.getByRole('button', { name: /^Bulan lalu/ });
    await expect.element(lastMonth).toHaveTextContent('Bulan lalu1–30 Sep');
    await userEvent.click(lastMonth);
    await expect.element(lastMonth).toHaveAttribute('aria-pressed', 'true');
    await expect.element(page.getByRole('grid', { name: 'Agustus 2026' })).toBeVisible();
    await userEvent.fill(page.getByLabelText('Selesai'), '2026-09-10');
    await userEvent.fill(page.getByLabelText('Mulai'), '2026-09-20');
    await expect.element(page.getByLabelText('Mulai')).toHaveValue('2026-09-10');
    await expect.element(page.getByLabelText('Selesai')).toHaveValue('2026-09-20');
    // Clearing a field changes nothing.
    await userEvent.clear(page.getByLabelText('Mulai'));
    await userEvent.click(page.getByRole('button', { name: 'Terapkan' }));
    expect(onValueChange).toHaveBeenCalledWith({ start: '2026-09-10', end: '2026-09-20' });
  });

  it('types a start while only the start is chosen', async () => {
    const onValueChange = vi.fn();
    await render(<Harness onValueChange={onValueChange} />);
    await open();
    await userEvent.click(day('Kamis, 8 Oktober 2026'));
    await userEvent.fill(page.getByLabelText('Mulai'), '2026-10-01');
    await userEvent.click(page.getByRole('button', { name: 'Terapkan' }));
    expect(onValueChange).toHaveBeenCalledWith({ start: '2026-10-01', end: '2026-10-08' });
  });

  it('closes on Escape without applying', async () => {
    const onValueChange = vi.fn();
    await render(<Harness onValueChange={onValueChange} />);
    await open();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('discards the draft on Batal and starts from the value again', async () => {
    const onValueChange = vi.fn();
    await render(<Harness onValueChange={onValueChange} />);
    await open();
    await userEvent.click(day('Kamis, 8 Oktober 2026'));
    await userEvent.click(page.getByRole('button', { name: 'Batal' }));
    expect(onValueChange).not.toHaveBeenCalled();
    await open();
    await expect.element(page.getByLabelText('Mulai')).toHaveValue('2026-10-12');
  });

  it('moves both months together', async () => {
    await render(<Harness />);
    await open();
    await userEvent.click(page.getByRole('button', { name: 'Bulan berikutnya' }));
    await expect.element(page.getByRole('grid', { name: 'Oktober 2026' })).toBeVisible();
    await expect.element(page.getByRole('grid', { name: 'November 2026' })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Bulan sebelumnya' }));
    await userEvent.click(page.getByRole('button', { name: 'Bulan sebelumnya' }));
    await expect.element(page.getByRole('grid', { name: 'Agustus 2026' })).toBeVisible();
    await expect.element(page.getByRole('grid', { name: 'September 2026' })).toBeVisible();
  });

  it('allows future dates when asked', async () => {
    await render(<Harness disableFuture={false} weekStartsOn={0} />);
    await open();
    await expect.element(page.getByLabelText('Selesai')).not.toHaveAttribute('max');
    await expect.element(day('Jumat, 16 Oktober 2026')).not.toHaveAttribute('aria-disabled');
  });
});
