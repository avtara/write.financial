// SPDX-License-Identifier: AGPL-3.0-only
import { CalendarDays } from 'lucide-react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { SegmentedControl } from './segmented-control.tsx';

type Span = 'week' | 'month' | 'year';

function Harness({ onValueChange, fill }: { onValueChange?: (value: Span) => void; fill?: boolean }) {
  const [value, setValue] = useState<Span>('month');
  return (
    <SegmentedControl
      label="Rentang waktu"
      value={value}
      onValueChange={(next) => {
        onValueChange?.(next);
        setValue(next);
      }}
      options={[
        { value: 'week', label: 'Minggu', icon: CalendarDays },
        { value: 'month', label: 'Bulan' },
        { value: 'year', label: 'Tahun', disabled: true },
      ]}
      className="w-[300px]"
      {...(fill === undefined ? {} : { fill })}
    />
  );
}

describe('SegmentedControl', () => {
  it('is a radio group with one tab stop; arrows move and choose', async () => {
    const onValueChange = vi.fn();
    const screen = await render(<Harness onValueChange={onValueChange} />);
    await expect.element(screen.getByRole('radiogroup', { name: 'Rentang waktu' })).toBeVisible();
    await expect.element(screen.getByRole('radio', { name: 'Bulan' })).toBeChecked();
    await userEvent.tab();
    await expect.element(screen.getByRole('radio', { name: 'Bulan' })).toHaveFocus();
    // Radix moves focus on a timer and checks the radio only while the arrow key is down; release it afterwards, as
    // a person does (Playwright's instant press would release it first).
    await userEvent.keyboard('{ArrowLeft>}');
    await expect.element(screen.getByRole('radio', { name: 'Minggu' })).toHaveFocus();
    await userEvent.keyboard('{/ArrowLeft}');
    await expect.element(screen.getByRole('radio', { name: 'Minggu' })).toBeChecked();
    expect(onValueChange).toHaveBeenLastCalledWith('week');
    await expect.element(screen.getByRole('radio', { name: 'Tahun' })).toBeDisabled();
  });

  it('chooses by click and can fill the width', async () => {
    const onValueChange = vi.fn();
    const screen = await render(<Harness onValueChange={onValueChange} fill />);
    await userEvent.click(screen.getByRole('radio', { name: 'Minggu' }));
    expect(onValueChange).toHaveBeenCalledWith('week');
    const widths = screen
      .getByRole('radio')
      .elements()
      .map((radio) => Math.round(radio.getBoundingClientRect().width));
    expect(new Set(widths).size).toBe(1);
  });
});
