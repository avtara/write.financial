// SPDX-License-Identifier: AGPL-3.0-only
import type { ReferenceRate } from '@wf/db/fx-rates';
import type { LocalDate } from '@wf/domain/period';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { BCA, CATEGORIES, categoryId, GOTRADE, JAGO, LEDGER, OVO } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { emptyValues, type TransactionFormValues } from './transaction-draft.ts';
import { TransferFields } from './transfer-fields.tsx';
import { useTransactionForm, type LedgerData } from './use-transaction-form.ts';

const server = vi.hoisted(() => ({
  getReferenceRate: vi.fn(),
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listTags: vi.fn(),
}));
vi.mock('../../server/fn/ledger.ts', () => server);

const IDS = { toAccount: 't-to', rate: 't-rate', received: 't-received', fee: 't-fee' };

const RATE: ReferenceRate = {
  base: 'USD',
  quote: 'IDR',
  rate: '16350',
  provider: 'open-er-api',
  rateType: 'blended',
  asOf: '2025-10-18' as LocalDate,
  fetchedAt: new Date('2025-10-19T02:30:00Z'),
  manual: false,
};

let latest: TransactionFormValues | undefined;
const capture = (values: TransactionFormValues) => {
  latest = values;
};

function Harness({ initial, data }: { readonly initial: TransactionFormValues; readonly data: LedgerData }) {
  const form = useTransactionForm({ initial, data, locale: 'id' });
  useEffect(() => {
    capture(form.values);
  });
  return (
    <>
      <TransferFields
        form={form}
        data={data}
        locale="id"
        timeZone="Asia/Jakarta"
        ids={IDS}
        error={(field) => (form.showErrors ? form.errors[field] : undefined)}
      />
      <button type="button" onClick={() => form.prepare({ timeZone: 'Asia/Jakarta', source: 'manual' })}>
        Periksa
      </button>
    </>
  );
}

function transfer(values: Partial<TransactionFormValues> = {}): TransactionFormValues {
  return {
    ...emptyValues({ type: 'transfer', accountId: BCA.id, date: '2026-10-19' as LocalDate, time: '09:30' }),
    ...values,
  };
}

async function renderTransfer(initial: TransactionFormValues, data: LedgerData = LEDGER) {
  const { screen } = await renderApp(<Harness initial={initial} data={data} />);
  return screen;
}

const check = () => userEvent.click(page.getByRole('button', { name: 'Periksa' }));

afterEach(() => {
  vi.resetAllMocks();
  latest = undefined;
});

describe('TransferFields — same currency', () => {
  it('picks the destination, shows balances before → after, and swaps the sides', async () => {
    const screen = await renderTransfer(transfer({ amountMinor: 100_000n }));
    const from = screen.getByRole('button', { name: 'Dari: BCA Tahapan' });
    const to = screen.getByRole('button', { name: 'Ke: Pilih rekening' });
    await expect.element(from).toMatchTextContent('Rp42.810.000');
    await expect.element(from).toMatchTextContent('Rp42.710.000');
    await expect.element(to).toMatchTextContent('Pilih rekening');

    await userEvent.click(to);
    await expect
      .element(page.getByRole('option', { name: /BCA Tahapan/ }))
      .toMatchTextContent('Sudah dipilih sebagai asal');
    await userEvent.click(page.getByRole('option', { name: /Bank Jago/ }));
    const jago = screen.getByRole('button', { name: 'Ke: Bank Jago' });
    await expect.element(jago).toMatchTextContent('Rp5.350.000');
    expect(latest).toMatchObject({ accountId: BCA.id, toAccountId: JAGO.id });
    expect(screen.getByRole('region', { name: 'Kurs' }).query()).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Tukar asal dan tujuan' }));
    expect(latest).toMatchObject({ accountId: JAGO.id, toAccountId: BCA.id });
    await expect.element(screen.getByRole('button', { name: 'Dari: Bank Jago' })).toMatchTextContent('Rp5.150.000');

    await userEvent.click(screen.getByRole('button', { name: 'Dari: Bank Jago' }));
    await expect
      .element(page.getByRole('option', { name: /BCA Tahapan/ }))
      .toMatchTextContent('Sudah dipilih sebagai tujuan');
    await userEvent.click(page.getByRole('option', { name: /OVO/ }));
    expect(latest).toMatchObject({ accountId: OVO.id, toAccountId: BCA.id });
    // OVO (Rp86.000) runs negative.
    await expect.element(screen.getByRole('button', { name: 'Dari: OVO' })).toMatchTextContent('−Rp14.000');
  });

  it('shows no balance after while there is no amount', async () => {
    const screen = await renderTransfer(transfer({ toAccountId: JAGO.id }));
    await expect
      .element(screen.getByRole('button', { name: 'Dari: BCA Tahapan' }))
      .toMatchTextContent(/^DariIDRBCA TahapanRp42\.810\.000$/);
  });

  it('asks for a destination, and one other than the source', async () => {
    const screen = await renderTransfer(transfer({ amountMinor: 1_000n }));
    await check();
    const to = screen.getByRole('button', { name: 'Ke: Pilih rekening' });
    await expect.element(to).toHaveAttribute('aria-invalid', 'true');
    await expect.element(to).toHaveAccessibleDescription('Pilih rekening tujuan');
  });

  it('asks for a destination other than the source', async () => {
    const same = await renderTransfer(transfer({ amountMinor: 1_000n, toAccountId: BCA.id }));
    await check();
    await expect
      .element(same.getByRole('alert'))
      .toMatchTextContent('Rekening asal dan tujuan tidak boleh sama · Pilih tujuan lain');
  });

  it('records a fee in the bank fee category, which can be changed', async () => {
    const screen = await renderTransfer(transfer({ amountMinor: 100_000n, toAccountId: JAGO.id }));
    const fee = screen.getByRole('textbox', { name: 'Biaya transfer' });
    await userEvent.fill(fee, '2500');
    await expect
      .element(screen.getByText(/^Catat .* sebagai pengeluaran$/))
      .toMatchTextContent('Catat Rp2.500 sebagai pengeluaran');
    const select = screen.getByRole('button', { name: 'Kategori biaya' });
    await expect.element(select).toMatchTextContent('Biaya bank');
    await userEvent.click(select);
    await userEvent.click(page.getByRole('option', { name: /Biaya platform/ }));
    expect(latest?.feeCategoryId).toBe(categoryId('system:platform_fee'));
    await userEvent.fill(fee, '3000');
    expect(latest).toMatchObject({ feeMinor: 3_000n, feeCategoryId: categoryId('system:platform_fee') });
    await userEvent.fill(fee, '0');
    expect(screen.getByRole('button', { name: 'Kategori biaya' }).query()).toBeNull();
  });

  it('asks for a fee category when there is no bank fee category, in the base currency without a source', async () => {
    const data = { ...LEDGER, categories: CATEGORIES.filter((category) => category.builtInKey !== 'system:bank_fee') };
    const screen = await renderTransfer(transfer({ accountId: null }), data);
    await userEvent.fill(screen.getByRole('textbox', { name: 'Biaya transfer' }), '2500');
    expect(latest?.feeCategoryId).toBeNull();
    await expect.element(screen.getByText(/^Catat/)).toMatchTextContent('Catat Rp2.500 sebagai pengeluaran');
    await expect.element(screen.getByRole('button', { name: 'Dari: Pilih rekening' })).toBeVisible();
    await check();
    await expect
      .element(screen.getByRole('button', { name: 'Kategori biaya' }))
      .toHaveAttribute('aria-invalid', 'true');
  });
});

describe('TransferFields — cross currency', () => {
  const cross = (values: Partial<TransactionFormValues> = {}) =>
    transfer({ amountMinor: 1_635_000n, toAccountId: GOTRADE.id, ...values });

  it('waits for the reference rate, then shows it with its source and the amount expected', async () => {
    const answer = Promise.withResolvers();
    server.getReferenceRate.mockReturnValueOnce(answer.promise);
    const screen = await renderTransfer(cross());
    const rate = screen.getByRole('region', { name: 'Kurs' });
    await expect.element(rate).toMatchTextContent('IDR → USD');
    await expect.element(rate).toMatchTextContent('Mengambil kurs terbaru…');
    await expect.element(rate).toMatchTextContent('Menunggu kurs untuk menghitung…');
    expect(server.getReferenceRate).toHaveBeenCalledWith({ data: { base: 'USD', quote: 'IDR' } });
    expect(
      screen.getByRole('button', { name: 'Perbarui kurs' }).element().querySelector('svg')?.getAttribute('class'),
    ).toContain('animate-spin');

    answer.resolve({ ok: true, value: RATE });
    await expect.element(rate).toMatchTextContent('1 USD = Rp16.350');
    await expect.element(rate).toMatchTextContent('Kurs acuan open-er-api · diperbarui 19 Okt, 09.30');
    await expect
      .element(screen.getByRole('link', { name: 'Rates By Exchange Rate API' }))
      .toHaveAttribute('href', 'https://www.exchangerate-api.com');
    await expect.element(rate).toMatchTextContent('Seharusnya US$100,00 · kurs efektif Rp16.350');
    await expect.element(rate).toMatchTextContent('Tidak ada selisih');
    await expect
      .element(screen.getByRole('textbox', { name: 'Diterima di Gotrade' }))
      .toHaveAttribute('placeholder', '100,00');
  });

  it('records the FX difference of what was received', async () => {
    server.getReferenceRate.mockResolvedValue({ ok: true, value: RATE });
    const screen = await renderTransfer(cross());
    const rate = screen.getByRole('region', { name: 'Kurs' });
    const received = screen.getByRole('textbox', { name: 'Diterima di Gotrade' });
    await userEvent.fill(received, '99');
    await expect.element(rate).toMatchTextContent('Selisih dicatat otomatis −Rp16.350');
    await expect.element(rate).toMatchTextContent('US$1,00 lebih kecil dari seharusnya · Selisih kurs');
    await userEvent.fill(received, '101');
    await expect.element(rate).toMatchTextContent('Selisih dicatat otomatis Rp16.350');
    await expect.element(rate).toMatchTextContent('US$1,00 lebih besar dari seharusnya · Selisih kurs');
    await userEvent.fill(received, '0');
    await check();
    await expect.element(screen.getByRole('alert')).toMatchTextContent('Masukkan jumlah diterima lebih dari 0');
    await expect.element(received).toHaveAttribute('aria-invalid', 'true');
  });

  it('leaves out the FX category name when the category is not listed', async () => {
    server.getReferenceRate.mockResolvedValue({ ok: true, value: RATE });
    const data = {
      ...LEDGER,
      categories: CATEGORIES.filter((category) => category.builtInKey !== 'system:fx_difference'),
    };
    const screen = await renderTransfer(cross({ receivedMinor: 9_900n }), data);
    await expect
      .element(screen.getByRole('region', { name: 'Kurs' }))
      .toMatchTextContent(/US\$1,00 lebih kecil dari seharusnya$/);
  });

  it('keeps the last rate while refreshing, and after a failed refresh', async () => {
    server.getReferenceRate.mockResolvedValueOnce({ ok: true, value: { ...RATE, provider: 'frankfurter' } });
    const screen = await renderTransfer(cross());
    const rate = screen.getByRole('region', { name: 'Kurs' });
    await expect.element(rate).toMatchTextContent('Kurs acuan frankfurter · diperbarui 19 Okt, 09.30');
    expect(screen.getByRole('link').query()).toBeNull();

    const refresh = Promise.withResolvers();
    server.getReferenceRate.mockReturnValueOnce(refresh.promise);
    await userEvent.click(screen.getByRole('button', { name: 'Perbarui kurs' }));
    await expect.element(rate).toMatchTextContent('1 USD = Rp16.350Mengambil kurs terbaru…');
    refresh.reject(new Error('offline'));
    await expect.element(rate).toMatchTextContent('Gagal memperbarui · pakai kurs 19 Okt, 09.30');
  });

  it('shows a saved manual rate as the reference', async () => {
    server.getReferenceRate.mockResolvedValue({ ok: true, value: { ...RATE, provider: 'manual', manual: true } });
    const screen = await renderTransfer(cross());
    await expect
      .element(screen.getByRole('region', { name: 'Kurs' }))
      .toMatchTextContent('Kurs manualmu · berlaku 18 Okt');
  });

  it('names a BI transaction rate as such', async () => {
    server.getReferenceRate.mockResolvedValue({
      ok: true,
      value: { ...RATE, provider: 'bi', rateType: 'bi_transaction' },
    });
    const screen = await renderTransfer(cross());
    await expect
      .element(screen.getByRole('region', { name: 'Kurs' }))
      .toMatchTextContent('Kurs transaksi BI · diperbarui 19 Okt, 09.30');
  });

  it('without a reference rate, takes a manual rate', async () => {
    server.getReferenceRate.mockResolvedValue({ ok: true, value: null });
    const screen = await renderTransfer(cross());
    const rate = screen.getByRole('region', { name: 'Kurs' });
    await expect.element(rate).toMatchTextContent('Belum ada kurs acuan — pakai Manual');
    await check();
    // A missing reference is not a typing error: the field asks for a manual rate instead.
    expect(screen.getByRole('alert').query()).toBeNull();

    await userEvent.click(screen.getByRole('radio', { name: 'Manual' }));
    const manual = screen.getByRole('textbox', { name: '1 USD = IDR' });
    await expect.element(manual).toHaveAccessibleDescription('Isi kurs manual');
    await userEvent.fill(manual, 'abc');
    await expect.element(screen.getByRole('alert')).toMatchTextContent('Masukkan kurs yang valid');
    await expect.element(manual).toHaveAttribute('aria-invalid', 'true');
    await userEvent.fill(manual, '16.500');
    expect(latest).toMatchObject({ rateMode: 'manual', manualRate: '16.500' });
    await expect.element(manual).toHaveAccessibleDescription('Isi kurs manual');
    await expect.element(rate).toMatchTextContent('Seharusnya US$99,09');
  });

  it('compares a manual rate with the reference', async () => {
    server.getReferenceRate.mockResolvedValue({ ok: true, value: RATE });
    const screen = await renderTransfer(cross({ rateMode: 'manual', manualRate: '16.500' }));
    await expect
      .element(screen.getByRole('textbox', { name: '1 USD = IDR' }))
      .toHaveAccessibleDescription('Manual · +0,9% dari acuan Rp16.350');
    await expect.element(screen.getByRole('textbox', { name: '1 USD = IDR' })).toHaveAttribute('aria-invalid', 'false');
    await userEvent.click(screen.getByRole('radio', { name: 'Acuan' }));
    expect(latest?.rateMode).toBe('reference');
  });
});
