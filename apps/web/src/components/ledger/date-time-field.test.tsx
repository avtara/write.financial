// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import { DateTimeField, type DateTimeFieldProps } from './date-time-field.tsx';

const server = vi.hoisted(() => ({ listTransactionDays: vi.fn() }));
vi.mock('../../server/fn/transactions-write.ts', () => server);

const TODAY = '2026-10-19' as LocalDate;

function Field({
  onChange,
  ...props
}: Partial<Omit<DateTimeFieldProps, 'onChange'>> & { readonly onChange?: DateTimeFieldProps['onChange'] }) {
  const [value, setValue] = useState({ date: TODAY, time: '19:30' });
  return (
    <DateTimeField
      date={value.date}
      time={value.time}
      onChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
      today={TODAY}
      timeZone="Asia/Jakarta"
      locale="id"
      {...props}
    />
  );
}

const trigger = () => page.getByRole('button', { name: /Okt 2026/ });

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('DateTimeField', () => {
  it('shows the date and time, and picks a preset', async () => {
    server.listTransactionDays.mockResolvedValue({ ok: true, value: [] });
    const onChange = vi.fn();
    await renderApp(<Field onChange={onChange} id="when" />);
    await expect.element(trigger()).toHaveTextContent('19 Okt 2026, 19.30');
    await expect.element(trigger()).toHaveAttribute('id', 'when');
    await expect.element(trigger()).toHaveClass('h-[42px]');
    await userEvent.click(trigger());
    for (const [label, day] of [
      ['Hari ini', '19 Okt'],
      ['Kemarin', '18 Okt'],
      ['2 hari lalu', '17 Okt'],
      ['Sabtu lalu', '17 Okt'],
      ['Awal bulan', '1 Okt'],
    ] as const) {
      await expect
        .element(page.getByRole('button', { name: new RegExp(`^${label}`) }))
        .toHaveTextContent(`${label}${day}`);
    }
    await expect.element(page.getByText('Menjadwalkan ke tanggal mendatang segera hadir.')).toBeVisible();
    await expect
      .element(page.getByRole('button', { name: 'Selasa, 20 Oktober 2026' }))
      .toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(page.getByRole('button', { name: /^Sabtu lalu/ }));
    expect(onChange).toHaveBeenCalledWith({ date: '2026-10-17', time: '19:30' });
    await expect.element(trigger()).toHaveTextContent('17 Okt 2026, 19.30');
  });

  it('marks days with transactions, loading each month once', async () => {
    server.listTransactionDays
      .mockResolvedValueOnce({ ok: true, value: ['2026-10-15', '2026-10-02'] })
      .mockResolvedValueOnce({ ok: false, code: 'UNAVAILABLE' });
    await renderApp(<Field />);
    await userEvent.click(trigger());
    expect(server.listTransactionDays).toHaveBeenCalledWith({ data: { from: '2026-09-24', to: '2026-11-14' } });
    await expect.element(page.getByRole('button', { name: 'Kamis, 15 Oktober 2026, ada transaksi' })).toBeVisible();

    // A failed month just shows no markers.
    await userEvent.click(page.getByRole('button', { name: 'Bulan sebelumnya' }));
    expect(server.listTransactionDays).toHaveBeenLastCalledWith({ data: { from: '2026-08-25', to: '2026-10-15' } });
    await expect.element(page.getByRole('grid', { name: 'September 2026' })).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Selasa, 15 September 2026' })).toBeVisible();

    await userEvent.click(page.getByRole('button', { name: 'Bulan berikutnya' }));
    await expect.element(page.getByRole('button', { name: 'Kamis, 15 Oktober 2026, ada transaksi' })).toBeVisible();
    expect(server.listTransactionDays).toHaveBeenCalledTimes(2);
  });

  it('sets the time, ignoring a cleared field', async () => {
    server.listTransactionDays.mockResolvedValue({ ok: true, value: [] });
    const onChange = vi.fn();
    await renderApp(<Field onChange={onChange} />);
    await userEvent.click(trigger());
    const time = page.getByLabelText('Jam');
    await expect.element(time).toHaveValue('19:30');
    await userEvent.fill(time, '08:05');
    expect(onChange).toHaveBeenLastCalledWith({ date: TODAY, time: '08:05' });
    await expect.element(trigger()).toHaveTextContent('19 Okt 2026, 08.05');
    onChange.mockClear();
    await userEvent.clear(time);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('goes back to now with "Sekarang"', async () => {
    server.listTransactionDays.mockResolvedValue({ ok: true, value: [] });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-19T14:05:00Z'));
    const onChange = vi.fn();
    await renderApp(<Field onChange={onChange} />);
    await userEvent.click(trigger());
    await userEvent.click(page.getByRole('button', { name: /^Kemarin/ }));
    await userEvent.click(trigger());
    await userEvent.click(page.getByRole('button', { name: 'Sekarang' }));
    expect(onChange).toHaveBeenLastCalledWith({ date: TODAY, time: '21:05' });
  });

  it('shows a caller label at the small size, and English times', async () => {
    await renderApp(<Field size="sm" triggerLabel="Hari ini" />);
    await expect.element(page.getByRole('button', { name: 'Hari ini' })).toHaveClass('h-8');
    expect(server.listTransactionDays).not.toHaveBeenCalled();
  });

  it('writes the time with a colon in English', async () => {
    await renderApp(<Field locale="en" />, { preferences: { locale: 'en' } });
    await expect.element(page.getByRole('button', { name: 'Oct 19, 2026, 19:30' })).toBeVisible();
  });
});
