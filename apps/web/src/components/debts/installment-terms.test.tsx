// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { cardInstallmentSchedule } from '../../lib/debts.ts';
import { DEFAULT_TERMS, InstallmentTerms, parseTerms, type InstallmentTermsValue } from './installment-terms.tsx';

const CARD = { statementDay: 20, dueDay: 5 };

function Harness({ disabled = false }: { readonly disabled?: boolean }) {
  const [value, setValue] = useState<InstallmentTermsValue>(DEFAULT_TERMS);
  const terms = parseTerms(value);
  return (
    <InstallmentTerms
      value={value}
      onChange={setValue}
      schedule={terms === null ? null : cardInstallmentSchedule(CARD, 3_000_000n, '2026-11-02' as LocalDate, terms)}
      currency="IDR"
      locale="id"
      disabled={disabled}
    />
  );
}

describe('parseTerms', () => {
  it('reads the interest and defaults the admin fee to 0', () => {
    expect(parseTerms({ tenor: 6, rate: '1,75', adminFeeMinor: null })).toEqual({
      tenor: 6,
      monthlyRateBps: 175,
      adminFeeMinor: 0n,
    });
    expect(parseTerms({ ...DEFAULT_TERMS, rate: 'x' })).toBeNull();
  });
});

describe('InstallmentTerms (hNvip)', () => {
  it('golden: 3 bulan → 1.000.000 on 20 Nov, 20 Des, 20 Jan; a longer tenor folds the rest', async () => {
    const { screen } = await renderApp(<Harness />);
    const schedule = screen.getByRole('list', { name: 'Jadwal cicilan' });
    await expect
      .element(schedule)
      .toHaveTextContent('1/3 · tagihan 20 Nov1.000.0002/3 · tagihan 20 Des1.000.0003/3 · tagihan 20 Jan1.000.000');
    await screen.getByRole('radio', { name: '12 bulan' }).click();
    await expect.element(schedule).toMatchTextContent(/\+9 cicilan lagi$/);
    await screen.getByRole('textbox', { name: 'Bunga' }).fill('abc');
    await expect.element(screen.getByText('Isi bunga 0–100, maksimal 2 desimal')).toBeVisible();
    await expect.element(screen.getByRole('list', { name: 'Jadwal cicilan' })).not.toBeInTheDocument();
    await screen.getByRole('textbox', { name: 'Bunga' }).fill('1');
    await screen.getByRole('textbox', { name: 'Biaya admin' }).fill('50000');
    await expect.element(screen.getByRole('list', { name: 'Jadwal cicilan' })).toMatchTextContent(/1\/12/);
  });

  it('disables every field until a transaction is picked', async () => {
    const { screen } = await renderApp(<Harness disabled />);
    await expect.element(screen.getByRole('radio', { name: '6 bulan' })).toBeDisabled();
    await expect.element(screen.getByRole('textbox', { name: 'Bunga' })).toBeDisabled();
  });
});
