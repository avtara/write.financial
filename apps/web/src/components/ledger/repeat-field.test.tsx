// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import type { RepeatValues } from './recurrence-draft.ts';
import { RepeatField } from './repeat-field.tsx';
import type { EntryKind } from './transaction-draft.ts';

const today = '2026-10-15' as LocalDate;

/** The field with its own state; `changes` sees every value. */
function Harness({ kind = 'expense', changes }: { kind?: EntryKind; changes: (next: RepeatValues | null) => void }) {
  const [value, setValue] = useState<RepeatValues | null>(null);
  return (
    <RepeatField
      value={value}
      onChange={(next) => {
        changes(next);
        setValue(next);
      }}
      date={today}
      kind={kind}
      locale="id"
    />
  );
}

describe('RepeatField', () => {
  it('"Ulangi" repeats monthly on the date with the next three dates and H-1; every option changes it', async () => {
    const changes = vi.fn();
    const { screen } = await renderApp(<Harness changes={changes} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ulangi' }));
    const section = screen.getByRole('region', { name: 'Ulangi setiap bulan' });
    await expect.element(section).toMatchTextContent('Tiap tgl 15 · masuk Perlu ditinjau dulu');
    await expect
      .element(section.getByRole('list', { name: 'Jadwal berikutnya' }))
      .toHaveTextContent('15 Nov15 Des15 Jan');
    const remind = section.getByRole('button', { name: 'Pengingat H-1 jam 09.00' });
    await expect.element(remind).toHaveAttribute('aria-pressed', 'true');

    await userEvent.selectOptions(section.getByRole('combobox', { name: 'Tiap tgl' }), '31');
    await expect.element(section.getByRole('list')).toHaveTextContent('31 Okt30 Nov31 Des');

    await userEvent.click(section.getByRole('radio', { name: 'Mingguan' }));
    const weekly = screen.getByRole('region', { name: 'Ulangi setiap minggu' });
    await expect.element(weekly).toMatchTextContent('Tiap Kamis · masuk Perlu ditinjau dulu');
    await expect.element(weekly.getByRole('list')).toHaveTextContent('22 Okt29 Okt5 Nov');
    await userEvent.selectOptions(weekly.getByRole('combobox', { name: 'Tiap hari' }), '1');
    await expect.element(weekly).toMatchTextContent('Tiap Senin');
    await expect.element(weekly.getByRole('list')).toHaveTextContent('19 Okt26 Okt2 Nov');

    await userEvent.click(weekly.getByRole('radio', { name: 'Tahunan' }));
    const yearly = screen.getByRole('region', { name: 'Ulangi setiap tahun' });
    await expect.element(yearly).toMatchTextContent('Tiap 15 Okt · masuk Perlu ditinjau dulu');

    await userEvent.selectOptions(yearly.getByRole('combobox', { name: 'Berakhir' }), 'after');
    const count = yearly.getByRole('spinbutton', { name: /Setelah/ });
    await expect.element(count).toHaveValue(6);
    await userEvent.fill(count, '2');
    await expect.element(yearly.getByRole('list')).toHaveTextContent('15 Okt');
    await userEvent.fill(count, '1');
    await expect.element(yearly.getByRole('list')).toHaveTextContent('tidak ada lagi');
    // Out of range values are ignored.
    await userEvent.fill(count, '0');
    expect(changes).toHaveBeenLastCalledWith(expect.objectContaining({ end: { type: 'after', count: 1 } }));
    await userEvent.selectOptions(yearly.getByRole('combobox', { name: 'Berakhir' }), 'never');
    await expect.element(yearly.getByRole('spinbutton')).not.toBeInTheDocument();

    await userEvent.click(yearly.getByRole('button', { name: 'Pengingat H-1 jam 09.00' }));
    await expect
      .element(yearly.getByRole('button', { name: 'Pengingat H-1 jam 09.00' }))
      .toHaveAttribute('aria-pressed', 'false');
    expect(changes).toHaveBeenLastCalledWith(expect.objectContaining({ freq: 'yearly', remind: false }));

    await userEvent.click(yearly.getByRole('button', { name: 'Hapus pengulangan' }));
    expect(changes).toHaveBeenLastCalledWith(null);
    await expect.element(screen.getByRole('button', { name: 'Ulangi' })).toBeVisible();
  });

  it('an income is "Pemasukan rutin"', async () => {
    const { screen } = await renderApp(<Harness kind="income" changes={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Pemasukan rutin' }));
    await expect.element(screen.getByRole('region', { name: 'Pemasukan rutin' })).toBeVisible();
  });
});
