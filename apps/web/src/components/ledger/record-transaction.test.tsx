// SPDX-License-Identifier: AGPL-3.0-only
import type { DraftView } from '@wf/db/drafts';
import type { LocalDate } from '@wf/domain/period';
import { Toaster } from '@wf/ui/toast';
import { Component, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { ACCOUNTS, BCA, CATEGORIES, categoryId, OVO, TAGS } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import {
  MissingRecordTransactionProviderError,
  RecordTransactionProvider,
  useRecordTransaction,
  type RecordPrefill,
} from './record-transaction.tsx';
import { emptyValues, toDraftPayload } from './transaction-draft.ts';

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

const ZONE = 'Asia/Jakarta';

function Opener({ prefill }: { readonly prefill?: RecordPrefill }) {
  const record = useRecordTransaction();
  return (
    <button
      type="button"
      onClick={() => {
        record.open(prefill);
      }}
    >
      Buka
    </button>
  );
}

async function renderProvider(prefill?: RecordPrefill) {
  const result = await renderApp(
    <>
      <RecordTransactionProvider timeZone={ZONE}>
        <Opener {...(prefill === undefined ? {} : { prefill })} />
      </RecordTransactionProvider>
      <Toaster label="Notifikasi" />
    </>,
  );
  return { ...result, invalidate: vi.spyOn(result.router, 'invalidate').mockResolvedValue() };
}

async function open(prefill?: RecordPrefill) {
  const rendered = await renderProvider(prefill);
  await userEvent.click(page.getByRole('button', { name: 'Buka' }));
  const sheet = page.getByRole('dialog', { name: /^Catat/ });
  await expect.element(sheet.getByRole('textbox', { name: 'Jumlah' })).toBeVisible();
  return { ...rendered, sheet, amount: sheet.getByRole('textbox', { name: 'Jumlah' }) };
}

function draft(id: string, payload: DraftView['payload']): DraftView {
  return { id, payload, updatedAt: new Date('2026-10-18T10:00:00Z') };
}

const draftPayload = (description: string, overrides = {}) =>
  toDraftPayload({
    ...emptyValues({ accountId: BCA.id, date: '2026-10-18' as LocalDate, time: '12:15' }),
    amountMinor: 18_000n,
    categoryId: categoryId('system:food'),
    description,
    ...overrides,
  });

beforeEach(() => {
  ledger.listAccounts.mockResolvedValue({
    ok: true,
    value: { baseCurrency: 'IDR', accounts: ACCOUNTS, availableMinor: 0n, missingRates: [] },
  });
  ledger.listCategories.mockResolvedValue({ ok: true, value: CATEGORIES });
  ledger.listTags.mockResolvedValue({ ok: true, value: TAGS });
  writes.listDrafts.mockResolvedValue({ ok: true, value: [] });
  writes.recordTransaction.mockResolvedValue({ ok: true, value: { id: 'tx-1' } });
  writes.removeDraft.mockResolvedValue({ ok: true, value: undefined });
  writes.saveDraft.mockResolvedValue({ ok: true, value: { id: 'draft-new' } });
});

afterEach(() => {
  vi.resetAllMocks();
});

class Catch extends Component<{ readonly children: ReactNode }, { readonly error: unknown }> {
  override state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  override render() {
    return this.state.error === null ? this.props.children : <p>{(this.state.error as Error).name}</p>;
  }
}

describe('useRecordTransaction', () => {
  it('needs its provider', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { screen } = await renderApp(
      <Catch>
        <Opener />
      </Catch>,
    );
    await expect.element(screen.getByText(MissingRecordTransactionProviderError.name)).toBeVisible();
    expect(new MissingRecordTransactionProviderError('x').name).toBe('MissingRecordTransactionProviderError');
  });
});

describe('RecordTransactionProvider', () => {
  it('opens with N, loading what the form picks from', async () => {
    const accounts = Promise.withResolvers();
    ledger.listAccounts.mockReturnValueOnce(accounts.promise);
    await renderProvider();
    await userEvent.keyboard('n');
    const sheet = page.getByRole('dialog', { name: 'Catat Transaksi' });
    await expect.element(sheet).toMatchTextContent('Memuat kategori…');
    expect(writes.listDrafts).toHaveBeenCalledWith({ data: { kind: 'transaction' } });
    accounts.resolve({
      ok: true,
      value: { baseCurrency: 'IDR', accounts: ACCOUNTS, availableMinor: 0n, missingRates: [] },
    });
    await expect.element(sheet.getByRole('textbox', { name: 'Jumlah' })).toBeVisible();
    await expect.element(sheet.getByRole('button', { name: 'Rekening' })).toMatchTextContent('BCA Tahapan');
    await expect.element(sheet).toMatchTextContent('Langsung tersimpan ke ringkasan, tidak perlu pindah halaman.');
  });

  it('closes while loading', async () => {
    ledger.listTags.mockReturnValueOnce(Promise.withResolvers().promise);
    await renderProvider();
    await userEvent.click(page.getByRole('button', { name: 'Buka' }));
    await userEvent.click(page.getByRole('button', { name: 'Tutup' }));
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    ['accounts', ledger.listAccounts, 'NOT_FOUND', 'Data ini sudah tidak ada. Muat ulang halaman.'],
    ['categories', ledger.listCategories, 'INVALID_CATEGORY', 'Periksa lagi data kategori.'],
    ['tags', ledger.listTags, 'INVALID_TAG', 'Tag hanya boleh berisi huruf, angka, dan tanda hubung.'],
    ['drafts', writes.listDrafts, 'INVALID_TRANSACTION', 'Periksa lagi data transaksi.'],
  ] as const)('explains why the %s could not be loaded', async (_what, fn, code, message) => {
    fn.mockResolvedValueOnce({ ok: false, code });
    await renderProvider();
    await userEvent.click(page.getByRole('button', { name: 'Buka' }));
    await expect.element(page.getByRole('dialog').getByRole('alert')).toMatchTextContent(message);
  });

  it('explains when loading failed outright', async () => {
    ledger.listTags.mockRejectedValueOnce(new Error('offline'));
    await renderProvider();
    await userEvent.click(page.getByRole('button', { name: 'Buka' }));
    await expect
      .element(page.getByRole('dialog').getByRole('alert'))
      .toMatchTextContent('Kategori & rekening tidak bisa dimuat. Coba lagi.');
  });

  it('opens prefilled as an income with a description', async () => {
    const { sheet } = await open({ type: 'income', description: 'gaji oktober' });
    await expect.element(sheet.getByRole('heading', { name: 'Catat Pemasukan' })).toBeVisible();
    await expect.element(sheet.getByRole('textbox', { name: 'Catatan', exact: true })).toHaveValue('gaji oktober');
  });

  it('saves, announces it with Urungkan, and closes', async () => {
    writes.removeTransactions.mockResolvedValueOnce({ ok: true, value: undefined });
    const { sheet, amount, invalidate } = await open();
    await userEvent.fill(amount, '25000');
    await userEvent.click(sheet.getByRole('button', { name: 'Makan & Dapur' }));
    await userEvent.click(sheet.getByRole('button', { name: /^Simpan/ }));
    expect(writes.recordTransaction).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'expense',
        accountId: BCA.id,
        amountMinor: 25_000n,
        source: 'manual',
      }) as unknown,
    });
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    const toast = page.getByRole('region', { name: 'Notifikasi' });
    await expect.element(toast).toMatchTextContent('Transaksi tersimpan');
    await expect.element(toast).toMatchTextContent('Makan & Dapur · −Rp25.000 · BCA Tahapan');
    expect(invalidate).toHaveBeenCalledOnce();
    await userEvent.click(toast.getByRole('button', { name: 'Urungkan' }));
    expect(writes.removeTransactions).toHaveBeenCalledWith({ data: { ids: ['tx-1'] } });
    await expect.element(toast).toMatchTextContent('Transaksi dibatalkan');
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it('says when undoing failed', async () => {
    writes.removeTransactions.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    const { sheet, amount } = await open({ type: 'income' });
    await userEvent.fill(amount, '1000000');
    await userEvent.click(sheet.getByRole('button', { name: 'Gaji' }));
    await userEvent.click(amount);
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    const toast = page.getByRole('region', { name: 'Notifikasi' });
    await expect.element(toast).toMatchTextContent('Gaji · Rp1.000.000 · BCA Tahapan');
    await userEvent.click(toast.getByRole('button', { name: 'Urungkan' }));
    await expect.element(toast).toMatchTextContent('Data ini sudah tidak ada. Muat ulang halaman.');
  });

  it('stays open for the next entry with ⇧↵ or "Tambah lagi setelah simpan"', async () => {
    const { sheet, amount } = await open();
    await userEvent.fill(amount, '25000');
    await userEvent.click(sheet.getByRole('button', { name: 'Makan & Dapur' }));
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    await expect.element(sheet).toMatchTextContent('1 transaksi tersimpan di sesi ini');
    await expect.element(amount).toHaveValue('');

    await userEvent.click(sheet.getByRole('checkbox', { name: 'Tambah lagi setelah simpan' }));
    await userEvent.click(sheet.getByRole('radio', { name: 'Transfer' }));
    await expect.element(sheet.getByRole('heading', { name: 'Catat Transfer' })).toBeVisible();
    await userEvent.fill(amount, '50000');
    await userEvent.click(sheet.getByRole('button', { name: 'Ke: Pilih rekening' }));
    await userEvent.click(page.getByRole('option', { name: /Bank Jago/ }));
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await expect.element(sheet).toMatchTextContent('2 transaksi tersimpan di sesi ini');
    await expect
      .element(page.getByRole('region', { name: 'Notifikasi' }))
      .toMatchTextContent('Transfer · −Rp50.000 · BCA Tahapan');
    await expect.element(sheet.getByRole('heading', { name: 'Catat Transfer' })).toBeVisible();
  });

  it('shows what is missing, and why saving failed', async () => {
    const pending = Promise.withResolvers();
    writes.recordTransaction
      .mockResolvedValueOnce({ ok: false, code: 'FX_RATE_MISSING' })
      .mockRejectedValueOnce(new Error('offline'))
      .mockReturnValueOnce(pending.promise);
    const { sheet, amount } = await open();
    await userEvent.click(sheet.getByRole('button', { name: /^Simpan/ }));
    await expect.element(sheet).toMatchTextContent('2 isian perlu dilengkapi');
    expect(sheet.getByRole('checkbox').query()).toBeNull();
    expect(writes.recordTransaction).not.toHaveBeenCalled();

    await userEvent.fill(amount, '25000');
    await userEvent.click(sheet.getByRole('button', { name: 'Makan & Dapur' }));
    await userEvent.click(sheet.getByRole('button', { name: /^Simpan/ }));
    await expect.element(sheet.getByText('Kurs untuk mata uang ini belum tersedia. Isi kurs manual.')).toBeVisible();
    await userEvent.click(sheet.getByRole('button', { name: /^Simpan/ }));
    await expect.element(sheet.getByText('Transaksi tidak bisa disimpan. Coba lagi.')).toBeVisible();
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(writes.recordTransaction).toHaveBeenCalledTimes(3);
    pending.resolve({ ok: true, value: { id: 'tx-3' } });
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes an untouched form at once', async () => {
    await open();
    await userEvent.click(page.getByRole('button', { name: 'Tutup' }));
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('button', { name: 'Buka' }));
    await userEvent.click(page.getByRole('button', { name: 'Batal' }));
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks before a filled form is closed: continue, discard, or keep a draft', async () => {
    writes.saveDraft.mockResolvedValueOnce({ ok: false, code: 'INVALID_TRANSACTION' });
    const { sheet, amount } = await open();
    await userEvent.fill(amount, '25000');
    await userEvent.click(sheet.getByRole('button', { name: 'Makan & Dapur' }));
    await userEvent.fill(sheet.getByRole('textbox', { name: 'Catatan', exact: true }), 'makan siang');
    await userEvent.click(sheet.getByRole('combobox', { name: 'Tag' }));
    await userEvent.keyboard('kantor{Enter}');

    await userEvent.click(sheet.getByRole('button', { name: 'Tutup' }));
    const confirm = page.getByRole('dialog', { name: 'Buang transaksi ini?' });
    await expect.element(confirm).toMatchTextContent('makan siangMakan & Dapur · BCA Tahapan · 1 tag−25.000');
    await userEvent.click(confirm.getByRole('button', { name: 'Lanjut mengisi' }));
    await expect.element(confirm).not.toBeInTheDocument();

    await userEvent.click(sheet.getByRole('button', { name: 'Batal' }));
    await userEvent.click(confirm.getByRole('button', { name: 'Simpan draf' }));
    const toast = page.getByRole('region', { name: 'Notifikasi' });
    await expect.element(toast).toMatchTextContent('Periksa lagi data transaksi.');
    await expect.element(confirm).toBeVisible();
    expect(writes.saveDraft).toHaveBeenCalledWith({
      data: {
        kind: 'transaction',
        payload: expect.objectContaining({ amountMinor: '25000', tags: ['kantor'] }) as unknown,
      },
    });

    await userEvent.click(confirm.getByRole('button', { name: 'Simpan draf' }));
    await expect.element(toast).toMatchTextContent('Draf tersimpan');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('discards a filled income', async () => {
    const { sheet, amount } = await open({ type: 'income' });
    await userEvent.fill(amount, '1000');
    await userEvent.click(sheet.getByRole('button', { name: 'Tutup' }));
    const confirm = page.getByRole('dialog', { name: 'Buang transaksi ini?' });
    await expect.element(confirm).toMatchTextContent('Catat PemasukanBCA Tahapan+1.000');
    await userEvent.click(confirm.getByRole('button', { name: 'Buang' }));
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    expect(writes.saveDraft).not.toHaveBeenCalled();
  });

  it('summarises a form without an amount or account', async () => {
    ledger.listAccounts.mockResolvedValueOnce({
      ok: true,
      value: { baseCurrency: 'IDR', accounts: [], availableMinor: 0n, missingRates: [] },
    });
    const { sheet } = await open();
    await userEvent.click(sheet.getByRole('button', { name: 'Makan & Dapur' }));
    await userEvent.click(sheet.getByRole('button', { name: 'Tutup' }));
    await expect
      .element(page.getByRole('dialog', { name: 'Buang transaksi ini?' }))
      .toMatchTextContent(/Catat TransaksiMakan & Dapur(Simpan draf)/);
  });

  it('offers saved drafts to continue or remove', async () => {
    writes.listDrafts.mockResolvedValueOnce({
      ok: true,
      value: [
        draft('d-kopi', draftPayload('kopi susu')),
        draft('d-blank', draftPayload('  ', { amountMinor: 5_000n })),
        draft('d-old', { version: 0 }),
      ],
    });
    writes.removeDraft.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    const { sheet, amount } = await open();
    const drafts = sheet.getByRole('region', { name: 'Draf tersimpan' });
    await expect.element(drafts).toMatchTextContent('kopi susuLanjutkanDraf tanpa catatanLanjutkanDraf tanpa catatan');
    expect(drafts.getByRole('button', { name: 'Lanjutkan' }).elements()).toHaveLength(2);

    const removeOld = drafts.getByRole('button', { name: 'Hapus draf Draf tanpa catatan' }).nth(1);
    await userEvent.click(removeOld);
    expect(writes.removeDraft).toHaveBeenLastCalledWith({ data: { id: 'd-old' } });
    await expect.element(drafts.getByRole('listitem')).toHaveLength(3);
    await userEvent.click(removeOld);
    await expect.element(drafts.getByRole('listitem')).toHaveLength(2);

    await userEvent.click(drafts.getByRole('button', { name: 'Lanjutkan' }).first());
    await expect.element(drafts).not.toBeInTheDocument();
    await expect.element(amount).toHaveValue('18.000');
    await expect.element(sheet.getByRole('textbox', { name: 'Catatan', exact: true })).toHaveValue('kopi susu');

    await userEvent.click(sheet.getByRole('button', { name: 'Tutup' }));
    await userEvent.click(page.getByRole('button', { name: 'Simpan draf' }));
    expect(writes.saveDraft).toHaveBeenCalledWith({
      data: {
        id: 'd-kopi',
        kind: 'transaction',
        payload: expect.objectContaining({ description: 'kopi susu' }) as unknown,
      },
    });
  });

  it('removes a continued draft once it is saved', async () => {
    writes.listDrafts.mockResolvedValueOnce({
      ok: true,
      value: [draft('d-kopi', draftPayload('kopi susu')), draft('d-teh', draftPayload('teh'))],
    });
    const { sheet } = await open();
    await userEvent.click(sheet.getByRole('button', { name: 'Lanjutkan' }).first());
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}');
    expect(writes.removeDraft).toHaveBeenCalledWith({ data: { id: 'd-kopi' } });
    const drafts = sheet.getByRole('region', { name: 'Draf tersimpan' });
    await expect.element(drafts).toMatchTextContent('teh');
    await expect.element(drafts.getByRole('listitem')).toHaveLength(1);
  });

  it('keeps a draft and switches to Pemasukan for a short account', async () => {
    writes.saveDraft.mockResolvedValueOnce({ ok: false, code: 'INVALID_TRANSACTION' });
    const { sheet, amount } = await open();
    await userEvent.click(sheet.getByRole('button', { name: 'Rekening' }));
    await userEvent.click(page.getByRole('option', { name: /OVO/ }));
    await userEvent.fill(amount, '100000');
    await expect.element(sheet.getByRole('button', { name: /^Tetap simpan/ })).toBeVisible();
    const incomeFirst = sheet.getByRole('button', { name: 'Catat pemasukan dulu' });
    await userEvent.click(incomeFirst);
    await expect
      .element(page.getByRole('region', { name: 'Notifikasi' }))
      .toMatchTextContent('Periksa lagi data transaksi.');
    await expect.element(sheet.getByRole('heading', { name: 'Catat Transaksi' })).toBeVisible();

    await userEvent.click(incomeFirst);
    await expect.element(sheet.getByRole('heading', { name: 'Catat Pemasukan' })).toBeVisible();
    await expect.element(sheet.getByRole('button', { name: 'Masuk ke rekening' })).toMatchTextContent('OVO');
    await expect.element(amount).toHaveValue('');
    expect(writes.saveDraft).toHaveBeenLastCalledWith({
      data: {
        kind: 'transaction',
        payload: expect.objectContaining({ accountId: OVO.id, amountMinor: '100000' }) as unknown,
      },
    });
  });
});
