// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { Toaster } from '@wf/ui/toast';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { RECORD_BUDGET } from '../../../test/budget-fixtures.ts';
import { BCA, categoryId, GOTRADE, JAGO, LEDGER } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { QuickAddBar } from './quick-add-bar.tsx';
import type { LedgerData } from './use-transaction-form.ts';

const ledger = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listTags: vi.fn(),
  getReferenceRate: vi.fn(),
}));
vi.mock('../../server/fn/ledger.ts', () => ledger);
const writes = vi.hoisted(() => ({
  recordTransaction: vi.fn(),
  removeTransactions: vi.fn(),
  restoreTransactions: vi.fn(),
  listDrafts: vi.fn(),
  saveDraft: vi.fn(),
  removeDraft: vi.fn(),
  listTransactionDays: vi.fn(),
}));
vi.mock('../../server/fn/transactions-write.ts', () => writes);
// The Record sheet loads the budget for its notes; the bar gets it through `data`.
vi.mock('../../server/fn/budget.ts', () => ({ getBudgetStatus: vi.fn() }));
// The record sheet's "Sesuaikan saldo" action (FR-R4) is not part of these tests.
vi.mock('../accounts/reconcile.tsx', () => ({ useReconcile: () => ({ openReconcile: vi.fn() }) }));

const TODAY = '2026-10-19' as LocalDate;

async function renderBar(data: LedgerData = LEDGER) {
  const result = await renderApp(
    <>
      <QuickAddBar data={data} locale="id" timeZone="Asia/Jakarta" today={TODAY} />
      <Toaster label="Notifikasi" />
    </>,
  );
  const bar = result.screen.getByRole('form', { name: 'Catat cepat' });
  return {
    ...result,
    bar,
    invalidate: vi.spyOn(result.router, 'invalidate').mockResolvedValue(),
    amount: bar.getByRole('textbox', { name: 'Jumlah' }),
    description: bar.getByRole('textbox', { name: 'Catatan' }),
    category: bar.getByRole('button', { name: 'Kategori' }),
    toast: page.getByRole('region', { name: 'Notifikasi' }),
  };
}

beforeEach(() => {
  writes.recordTransaction.mockResolvedValue({ ok: true, value: { id: 'tx-1' } });
  writes.listTransactionDays.mockResolvedValue({ ok: true, value: [] });
  ledger.getReferenceRate.mockResolvedValue({ ok: true, value: null });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('QuickAddBar', () => {
  it('saves with ↵, guessing the category from the description, and starts over', async () => {
    const { bar, amount, description, category, toast, invalidate } = await renderBar();
    await expect.element(bar.getByRole('button', { name: 'Hari ini' })).toBeVisible();
    await userEvent.fill(amount, '25000');
    await userEvent.fill(description, 'makan siang');
    await expect.element(category).toMatchTextContent('Makan & Dapur');
    await userEvent.fill(description, 'ok');
    await expect.element(category).toMatchTextContent('Kategori');
    await userEvent.fill(description, 'makan siang');
    await userEvent.keyboard('{Enter}');
    expect(writes.recordTransaction).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'expense',
        accountId: BCA.id,
        amountMinor: 25_000n,
        categoryId: categoryId('system:food'),
        description: 'makan siang',
        source: 'quick',
      }) as unknown,
    });
    await expect.element(toast).toMatchTextContent('Makan & Dapur · −Rp25.000 · BCA Tahapan');
    expect(invalidate).toHaveBeenCalledOnce();
    writes.removeTransactions.mockResolvedValueOnce({ ok: true, value: undefined });
    await userEvent.click(toast.getByRole('button', { name: 'Urungkan' }));
    await expect.element(toast).toMatchTextContent('Transaksi dibatalkan');
    expect(invalidate).toHaveBeenCalledTimes(2);
    await expect.element(amount).toHaveValue('');
    await expect.element(description).toHaveValue('');
    await expect.element(category).toMatchTextContent('Kategori');
  });

  it('takes the amount from the description and keeps a picked category', async () => {
    const { bar, description, category } = await renderBar();
    await userEvent.click(category);
    await userEvent.click(page.getByRole('option', { name: /Transportasi/ }));
    await userEvent.fill(description, 'makan kopi 25rb');
    await expect.element(category).toMatchTextContent('Transportasi');
    await userEvent.click(bar.getByRole('button', { name: /^Simpan/ }));
    await vi.waitFor(() => {
      expect(writes.recordTransaction).toHaveBeenCalledWith({
        data: expect.objectContaining({
          amountMinor: 25_000n,
          categoryId: categoryId('system:transport'),
          description: 'makan kopi',
        }) as unknown,
      });
    });
  });

  it('names the first problem, one at a time', async () => {
    const { bar, amount, description, category } = await renderBar();
    await userEvent.fill(description, 'tanpa angka');
    await userEvent.keyboard('{Enter}');
    const alert = bar.getByRole('alert');
    await expect.element(alert).toMatchTextContent('Isi jumlah dulu sebelum menyimpan');
    await expect.element(amount).toHaveAttribute('aria-invalid', 'true');
    await userEvent.fill(amount, '1000');
    await expect.element(alert).toMatchTextContent('Pilih satu kategori');
    await expect.element(category).toHaveAttribute('aria-invalid', 'true');
    await userEvent.click(category);
    await userEvent.click(page.getByRole('option', { name: /Makan & Dapur/ }));
    await expect.element(alert).not.toBeInTheDocument();
    expect(writes.recordTransaction).not.toHaveBeenCalled();
  });

  it('asks for an account when there is none', async () => {
    const { bar, amount, category } = await renderBar({ ...LEDGER, accounts: [] });
    await userEvent.fill(amount, '1000');
    await userEvent.click(category);
    await userEvent.click(page.getByRole('option', { name: /Makan & Dapur/ }));
    await userEvent.click(bar.getByRole('button', { name: /^Simpan/ }));
    await expect.element(bar.getByRole('alert')).toMatchTextContent('Pilih rekening');
  });

  it('records an income, keeping what was typed when switching', async () => {
    const { bar, amount, toast } = await renderBar();
    await userEvent.fill(amount, '1000000');
    await userEvent.click(bar.getByRole('tab', { name: 'Masuk' }));
    await expect.element(amount).toHaveValue('1.000.000');
    const source = bar.getByRole('button', { name: 'Sumber pemasukan' });
    await userEvent.click(source);
    await expect.element(page.getByPlaceholder('Cari kategori…')).toBeVisible();
    await userEvent.click(page.getByRole('option', { name: /Gaji/ }));
    await userEvent.click(bar.getByRole('button', { name: /^Simpan/ }));
    await expect.element(toast).toMatchTextContent('Gaji · Rp1.000.000 · BCA Tahapan');
    await expect.element(bar.getByRole('tab', { name: 'Masuk' })).toHaveAttribute('aria-selected', 'true');
  });

  it('records a transfer between two accounts', async () => {
    const { bar, amount, toast } = await renderBar();
    await userEvent.click(bar.getByRole('tab', { name: 'Transfer' }));
    await userEvent.fill(amount, '50000');
    await userEvent.click(bar.getByRole('button', { name: /^Simpan/ }));
    const alert = bar.getByRole('alert');
    await expect.element(alert).toMatchTextContent('Pilih rekening tujuan');

    await userEvent.click(bar.getByRole('button', { name: 'Ke' }));
    await userEvent.click(page.getByRole('option', { name: /Gotrade/ }));
    await expect.element(alert).toMatchTextContent('Kurs belum tersedia — catat lewat sheet Catat Transaksi (N)');
    expect(ledger.getReferenceRate).toHaveBeenCalledWith({ data: { base: GOTRADE.currency, quote: 'IDR' } });

    await userEvent.click(bar.getByRole('button', { name: 'Dari' }));
    await userEvent.click(page.getByRole('option', { name: /Bank Jago/ }));
    await userEvent.click(bar.getByRole('button', { name: 'Ke' }));
    await userEvent.click(page.getByRole('option', { name: /BCA Tahapan/ }));
    await expect.element(alert).not.toBeInTheDocument();
    await userEvent.click(bar.getByRole('button', { name: /^Simpan/ }));
    expect(writes.recordTransaction).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'transfer',
        fromAccountId: JAGO.id,
        toAccountId: BCA.id,
        sentMinor: 50_000n,
      }) as unknown,
    });
    await expect.element(toast).toMatchTextContent('Transfer · −Rp50.000 · Bank Jago');
  });

  it('keeps the chosen date for the next entry', async () => {
    const { bar, amount, category } = await renderBar();
    await userEvent.click(bar.getByRole('button', { name: 'Hari ini' }));
    await userEvent.click(page.getByRole('button', { name: /^Kemarin/ }));
    await expect.element(bar.getByRole('button', { name: /^18 Okt 2026, / })).toBeVisible();
    await userEvent.fill(amount, '1000');
    await userEvent.click(category);
    await userEvent.click(page.getByRole('option', { name: /Makan & Dapur/ }));
    await userEvent.click(bar.getByRole('button', { name: /^Simpan/ }));
    await expect.element(amount).toHaveValue('');
    await expect.element(bar.getByRole('button', { name: /^18 Okt 2026/ })).toBeVisible();
  });

  it('says why saving failed, saving once while pending', async () => {
    const pending = Promise.withResolvers();
    writes.recordTransaction
      .mockResolvedValueOnce({ ok: false, code: 'INVALID_TRANSACTION' })
      .mockRejectedValueOnce(new Error('offline'))
      .mockReturnValueOnce(pending.promise);
    const { bar, amount, category, toast } = await renderBar();
    await userEvent.fill(amount, '1000');
    await userEvent.click(category);
    await userEvent.click(page.getByRole('option', { name: /Makan & Dapur/ }));
    const save = bar.getByRole('button', { name: /^Simpan/ });
    await userEvent.click(save);
    await expect.element(toast).toMatchTextContent('Periksa lagi data transaksi.');
    await userEvent.click(save);
    await expect.element(toast).toMatchTextContent('Transaksi tidak bisa disimpan. Coba lagi.');
    await expect.element(amount).toHaveValue('1.000');
    await userEvent.click(amount);
    await userEvent.keyboard('{Enter}');
    await expect.element(save).toBeDisabled();
    // ↵ again while the save is in progress does not save twice.
    await userEvent.keyboard('{Enter}');
    expect(writes.recordTransaction).toHaveBeenCalledTimes(3);
    pending.resolve({ ok: true, value: { id: 'tx-3' } });
    await expect.element(amount).toHaveValue('');
  });
  it('picks with ↵ in the category search and on buttons without saving', async () => {
    const { category } = await renderBar();
    await userEvent.click(category);
    await userEvent.keyboard('Makan{Enter}');
    await expect.element(category).toHaveTextContent('Makan & Dapur');
    await userEvent.keyboard('{Enter}');
    expect(writes.recordTransaction).not.toHaveBeenCalled();
  });

  it('notes the budget beside expense categories, counting a rupiah amount', async () => {
    const { amount, category } = await renderBar({ ...LEDGER, budget: RECORD_BUDGET });
    await userEvent.click(category);
    await expect.element(page.getByRole('option', { name: /^Makan & Dapur/ })).toMatchTextContent('sisa Rp300.000');
    await userEvent.keyboard('{Escape}');
    await userEvent.fill(amount, '400000');
    await userEvent.click(category);
    await expect
      .element(page.getByRole('option', { name: /^Makan & Dapur/ }))
      .toMatchTextContent('akan lewat Rp100.000');
    await expect.element(page.getByRole('option', { name: /^Transportasi/ })).toMatchTextContent('sisa Rp400.000');
  });

  it('does not count an amount in another currency against the budget', async () => {
    const { amount, category } = await renderBar({ ...LEDGER, accounts: [GOTRADE], budget: RECORD_BUDGET });
    await userEvent.fill(amount, '5000');
    await userEvent.click(category);
    await expect.element(page.getByRole('option', { name: /^Makan & Dapur/ })).toMatchTextContent('sisa Rp300.000');
  });
});
