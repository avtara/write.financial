// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OCTOBER_BILL, VISA_ACCOUNT, visa } from '../../../test/debt-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { transactionRow } from '../../../test/transaction-fixtures.ts';
import { ConvertForm } from './convert-form.tsx';

const fake = vi.hoisted(() => ({ convertCardTransaction: vi.fn() }));
vi.mock('../../server/fn/debts.ts', () => fake);

const OCT_16 = '2026-10-16' as LocalDate;
const BIG = transactionRow('tx-tv', {
  accountId: 'acc-visa',
  localDate: '2026-10-14' as LocalDate,
  description: null,
  merchant: 'Erafone',
  amountMinor: -3_000_000n,
});
const CARD = { ...visa(), transactions: [...OCTOBER_BILL, BIG] };

afterEach(() => {
  vi.clearAllMocks();
});

describe('ConvertForm (OEZIG)', () => {
  it('offers only expenses of at least Rp500.000, then converts the picked one', async () => {
    const onSaved = vi.fn();
    fake.convertCardTransaction
      .mockResolvedValueOnce({ ok: false, code: 'INVALID_DEBT' })
      .mockResolvedValueOnce({ ok: true, value: 'debt' });
    const { screen } = await renderApp(
      <ConvertForm
        cards={[CARD]}
        accounts={[VISA_ACCOUNT]}
        today={OCT_16}
        locale="id"
        onSaved={onSaved}
        onCancel={vi.fn()}
      />,
    );
    await expect.element(screen.getByText('Pilih transaksi dulu')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Ubah jadi cicilan' })).toBeDisabled();
    await expect.element(screen.getByRole('radio', { name: /Erafone/ })).toBeVisible();
    expect(screen.getByRole('radio', { name: /Superindo/ }).elements()).toHaveLength(0);
    // Submitting without a pick (Enter in a field) does nothing.
    const submitForm = () => {
      screen.getByRole('button', { name: 'Ubah jadi cicilan' }).element().closest('form')?.requestSubmit();
    };
    submitForm();
    await screen.getByRole('radio', { name: /Erafone/ }).click();
    await screen.getByRole('textbox', { name: 'Bunga' }).fill('x');
    submitForm();
    expect(fake.convertCardTransaction).not.toHaveBeenCalled();
    await screen.getByRole('textbox', { name: 'Bunga' }).fill('0');
    await expect
      .element(screen.getByRole('list', { name: 'Jadwal cicilan' }))
      .toMatchTextContent(/1\/3 · tagihan 20 Okt1\.000\.000/);
    await expect.element(screen.getByText('Bisa diubah jadi biasa lagi selama belum tertagih')).toBeVisible();
    await screen.getByRole('button', { name: 'Ubah jadi cicilan' }).click();
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Periksa lagi data utang atau cicilan.');
    expect(fake.convertCardTransaction).toHaveBeenCalledWith({
      data: { transactionId: 'tx-tv', tenor: 3, monthlyRateBps: 0, adminFeeMinor: 0n },
    });
    expect(onSaved).not.toHaveBeenCalled();
    await screen.getByRole('button', { name: 'Ubah jadi cicilan' }).click();
    await vi.waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith('debt');
    });
  });

  it('switches cards, shows an empty card, a card without days, and no card at all', async () => {
    const onCancel = vi.fn();
    const other = { ...visa({ accountId: 'acc-other', name: 'Mandiri', statementDay: null }), transactions: [] };
    const empty = { ...visa({ accountId: 'acc-empty', name: 'Jenius' }), transactions: [] };
    const { screen } = await renderApp(
      <ConvertForm
        cards={[CARD, other, empty]}
        accounts={[VISA_ACCOUNT]}
        today={OCT_16}
        locale="id"
        initialCardId="acc-other"
        onSaved={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await expect.element(screen.getByText(/Atur tanggal cetak tagihan/)).toBeVisible();
    await screen.getByRole('combobox', { name: 'Kartu' }).selectOptions('acc-empty');
    await expect.element(screen.getByText('Belum ada transaksi di kartu ini yang bisa dicicil')).toBeVisible();
    await expect.element(screen.getByText(/tagihan berjalan\s*Rp1\.250\.000/)).toBeVisible();
    await screen.getByRole('button', { name: 'Batal' }).click();
    expect(onCancel).toHaveBeenCalled();
    await screen.unmount();

    const none = await renderApp(
      <ConvertForm cards={[]} accounts={[]} today={OCT_16} locale="id" onSaved={vi.fn()} onCancel={onCancel} />,
    );
    await expect.element(none.screen.getByText('Belum ada kartu kredit')).toBeVisible();
    await expect
      .element(none.screen.getByRole('link', { name: 'Tambahkan kartu di Rekening & dompet' }))
      .toHaveAttribute('href', '/accounts');
    await none.screen.getByRole('button', { name: 'Batal' }).click();
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('names a transaction without description or merchant after the card', async () => {
    const card = { ...visa(), transactions: [{ ...BIG, merchant: null }] };
    const { screen } = await renderApp(
      <ConvertForm cards={[card]} accounts={[]} today={OCT_16} locale="id" onSaved={vi.fn()} onCancel={vi.fn()} />,
    );
    await expect.element(screen.getByRole('radio', { name: /BCA Visa/ })).toBeVisible();
  });
});
