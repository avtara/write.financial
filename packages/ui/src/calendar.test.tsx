// SPDX-License-Identifier: AGPL-3.0-only
import { parseLocalDate as d, type LocalDate } from '@wf/domain/period';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';
import { Calendar, type CalendarProps } from './calendar.tsx';

const LABELS = { previousMonth: 'Bulan sebelumnya', nextMonth: 'Bulan berikutnya' };
const TODAY = d('2026-10-15');

type HarnessProps = Partial<Omit<CalendarProps, 'month' | 'onMonthChange'>> & { start?: LocalDate };

/** Owns the shown month like a real caller. */
function Harness({ start = TODAY, onSelect = () => {}, ...props }: HarnessProps) {
  const [month, setMonth] = useState(start);
  return (
    <Calendar
      month={month}
      onMonthChange={setMonth}
      onSelect={onSelect}
      today={TODAY}
      locale="id"
      labels={LABELS}
      {...props}
    />
  );
}

const day = (name: string) => page.getByRole('button', { name, exact: true });

describe('Calendar', () => {
  it('is a grid of the month with Monday first and day names as column headers', async () => {
    const screen = await render(<Harness selected={TODAY} />);
    const grid = screen.getByRole('grid', { name: 'Oktober 2026' });
    await expect.element(grid).toBeVisible();
    const headers = [...grid.element().querySelectorAll('th')];
    expect(headers.map((header) => header.textContent)).toEqual(['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']);
    expect(headers[0]?.abbr).toBe('Senin');
    // Days of September and November only complete the weeks.
    expect(screen.getByRole('button', { name: /September/ }).query()).toBeNull();
    await expect.element(day('Kamis, 15 Oktober 2026')).toHaveAttribute('aria-current', 'date');
    await expect
      .element(day('Kamis, 15 Oktober 2026').element().closest('td') as HTMLElement)
      .toHaveAttribute('aria-selected', 'true');
  });

  it('starts the week on Sunday when asked and in English', async () => {
    const screen = await render(<Harness weekStartsOn={0} locale="en" />);
    const headers = [...screen.getByRole('grid').element().querySelectorAll('th')];
    expect(headers[0]?.textContent).toBe('Sun');
  });

  it('selects a day by click and by keyboard', async () => {
    const onSelect = vi.fn();
    await render(<Harness onSelect={onSelect} />);
    await userEvent.click(day('Senin, 5 Oktober 2026'));
    expect(onSelect).toHaveBeenLastCalledWith('2026-10-05');
    await userEvent.keyboard('{ArrowRight}{Enter}');
    expect(onSelect).toHaveBeenLastCalledWith('2026-10-06');
  });

  it('keeps one day in the tab order and moves with arrows, Home/End and PageUp/PageDown', async () => {
    await render(
      <>
        <button type="button">sebelum</button>
        <Harness selected={d('2026-10-14')} />
      </>,
    );
    await userEvent.click(page.getByRole('button', { name: 'sebelum' }));
    await userEvent.tab({ shift: false });
    await userEvent.tab();
    await userEvent.tab();
    // Previous month, next month, then the selected day.
    await expect.element(day('Rabu, 14 Oktober 2026')).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect.element(day('Rabu, 21 Oktober 2026')).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}{ArrowLeft}');
    await expect.element(day('Selasa, 13 Oktober 2026')).toHaveFocus();
    await userEvent.keyboard('{End}');
    await expect.element(day('Minggu, 18 Oktober 2026')).toHaveFocus();
    await userEvent.keyboard('{Home}');
    await expect.element(day('Senin, 12 Oktober 2026')).toHaveFocus();
    await userEvent.keyboard('{PageDown}');
    await expect.element(page.getByRole('grid', { name: 'November 2026' })).toBeVisible();
    await expect.element(day('Kamis, 12 November 2026')).toHaveFocus();
    await userEvent.keyboard('{PageUp}{PageUp}');
    await expect.element(day('Sabtu, 12 September 2026')).toHaveFocus();
    // Other keys are left alone.
    await userEvent.keyboard('a');
    await expect.element(day('Sabtu, 12 September 2026')).toHaveFocus();
  });

  it('crosses into the neighbouring month with the arrow keys', async () => {
    await render(<Harness start={d('2026-10-01')} selected={d('2026-10-01')} />);
    (day('Kamis, 1 Oktober 2026').element() as HTMLButtonElement).focus();
    await userEvent.keyboard('{ArrowLeft}');
    await expect.element(page.getByRole('grid', { name: 'September 2026' })).toBeVisible();
    await expect.element(day('Rabu, 30 September 2026')).toHaveFocus();
  });

  it('moves between months with the buttons, focusing the first day when tabbing in', async () => {
    await render(<Harness />);
    await userEvent.click(page.getByRole('button', { name: 'Bulan berikutnya' }));
    await expect.element(page.getByRole('grid', { name: 'November 2026' })).toBeVisible();
    await userEvent.tab();
    await expect.element(day('Minggu, 1 November 2026')).toHaveFocus();
    await userEvent.click(page.getByRole('button', { name: 'Bulan sebelumnya' }));
    await userEvent.click(page.getByRole('button', { name: 'Bulan sebelumnya' }));
    await expect.element(page.getByRole('grid', { name: 'September 2026' })).toBeVisible();
  });

  it('lets future days be seen but not chosen', async () => {
    const onSelect = vi.fn();
    await render(<Harness onSelect={onSelect} disableFuture />);
    const future = day('Jumat, 16 Oktober 2026');
    await expect.element(future).toHaveAttribute('aria-disabled', 'true');
    // Playwright treats `aria-disabled` as disabled; click anyway, as a mouse would.
    await userEvent.click(future, { force: true });
    expect(onSelect).not.toHaveBeenCalled();
    await expect.element(day('Kamis, 15 Oktober 2026')).not.toHaveAttribute('aria-disabled');
  });

  it('marks days and announces the marker', async () => {
    const marked = new Set(['2026-10-01', '2026-10-15']);
    await render(<Harness selected={TODAY} isMarked={(date) => marked.has(date)} markerLabel="ada transaksi" />);
    await expect.element(day('Kamis, 1 Oktober 2026, ada transaksi')).toBeVisible();
    await expect.element(day('Kamis, 15 Oktober 2026, ada transaksi')).toBeVisible();
    await expect.element(day('Jumat, 2 Oktober 2026')).toBeVisible();
    expect(day('Kamis, 1 Oktober 2026, ada transaksi').element().querySelector('span')?.className).toContain('bg-red');
    expect(day('Kamis, 15 Oktober 2026, ada transaksi').element().querySelector('span')?.className).toContain(
      'bg-primary-fg',
    );
  });

  it('shows the dot without a label when none is given', async () => {
    await render(<Harness isMarked={() => true} />);
    expect(day('Jumat, 2 Oktober 2026').element().querySelector('span')).not.toBeNull();
  });

  it('bands a range and highlights both ends; a started range shows its start', async () => {
    const screen = await render(<Harness range={{ start: d('2026-10-12'), end: d('2026-10-14') }} />);
    const selected = () =>
      [...screen.container.querySelectorAll('td[aria-selected="true"] button')].map((button) => button.textContent);
    expect(selected()).toEqual(['12', '13', '14']);
    await screen.rerender(
      <Calendar
        month={TODAY}
        onMonthChange={() => {}}
        onSelect={() => {}}
        range={{ start: d('2026-10-12'), end: null }}
        today={TODAY}
        locale="id"
        labels={LABELS}
      />,
    );
    expect(selected()).toEqual(['12']);
  });

  it('shows only the month buttons it is asked for', async () => {
    const screen = await render(
      <>
        <Harness navigation="previous" />
        <Harness navigation="next" />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Bulan sebelumnya' }).elements()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Bulan berikutnya' }).elements()).toHaveLength(1);
  });
});
