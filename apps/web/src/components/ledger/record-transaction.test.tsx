// SPDX-License-Identifier: AGPL-3.0-only
import type { DraftView } from '@wf/db/drafts';
import type { LocalDate } from '@wf/domain/period';
import { toast, Toaster } from '@wf/ui/toast';
import { Component, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent, type Locator } from 'vitest/browser';
import { budgetStatus, RECORD_BUDGET } from '../../../test/budget-fixtures.ts';
import { visa } from '../../../test/debt-fixtures.ts';
import { DANA_DARURAT, PERPANJANG_STNK, SERVIS_MOTOR, source } from '../../../test/goal-fixtures.ts';
import { ACCOUNTS, BCA, CARD, CATEGORIES, categoryId, JAGO, OVO, TAGS } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { listAutoRules } from '../../server/fn/rules.ts';
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
vi.mock('./receipt-entry.tsx', () => ({ ReceiptEntry: () => null }));
vi.mock('../../server/fn/rules.ts', () => ({
  listAutoRules: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
}));
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
const reconcile = vi.hoisted(() => ({ openReconcile: vi.fn() }));
vi.mock('../accounts/reconcile.tsx', () => ({ useReconcile: () => reconcile }));
const budget = vi.hoisted(() => ({ getBudgetStatus: vi.fn() }));
vi.mock('../../server/fn/budget.ts', () => budget);
const schedules = vi.hoisted(() => ({
  createRecurrence: vi.fn(),
  listSubscriptions: vi.fn(() => Promise.resolve({ ok: true, value: { subscriptions: [] } })),
}));
vi.mock('../../server/fn/schedules.ts', () => schedules);
const debts = vi.hoisted(() => ({
  getCardPaymentContext: vi.fn(),
  recordCardInstallment: vi.fn(),
  recordCardPayment: vi.fn(),
}));
vi.mock('../../server/fn/debts.ts', () => debts);
const goals = vi.hoisted(() => ({ listGoals: vi.fn(), spendFromGoal: vi.fn() }));
vi.mock('../../server/fn/goals.ts', () => goals);
const receivables = vi.hoisted(() => ({ getSplitBillContext: vi.fn(), recordSplitBill: vi.fn() }));
vi.mock('../../server/fn/receivables.ts', () => receivables);

const ZONE = 'Asia/Jakarta';
/** Perpanjang STNK at 100%, kept in BCA Tahapan; Servis motor kept in Bank Jago. */
const STNK = { ...PERPANJANG_STNK, savedMinor: 850_000n };
const SERVIS = {
  ...SERVIS_MOTOR,
  sources: [
    source({
      id: 'jago',
      accountId: JAGO.id,
      accountName: JAGO.displayName,
      amountMinor: 720_000n,
      valueMinor: 720_000n,
    }),
  ],
};

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
  budget.getBudgetStatus.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
  goals.listGoals.mockResolvedValue({ ok: true, value: [STNK, SERVIS] });
});

afterEach(() => {
  vi.useRealTimers();
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

  it('opens prefilled with a day, time, accounts, and amount (a top-up, the calendar)', async () => {
    const { sheet } = await open({
      type: 'transfer',
      accountId: BCA.id,
      toAccountId: OVO.id,
      amountMinor: 243_000n,
      date: '2026-10-12' as LocalDate,
      time: '12:00',
    });
    await userEvent.click(sheet.getByRole('button', { name: /^Simpan/ }));
    expect(writes.recordTransaction).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'transfer',
        fromAccountId: BCA.id,
        toAccountId: OVO.id,
        sentMinor: 243_000n,
        occurredAt: new Date('2026-10-12T05:00:00Z'),
      }) as unknown,
    });
    // The saved toast would otherwise linger into the next test.
    toast.dismiss();
    await expect.element(page.getByRole('region', { name: 'Notifikasi' }).getByRole('button')).not.toBeInTheDocument();
  });

  it('suggests a rule that matches one of the user’s own registered subscriptions', async () => {
    vi.mocked(listAutoRules).mockResolvedValueOnce({
      ok: true,
      value: [
        {
          id: 'r-sub',
          name: 'Langganan streaming',
          enabled: true,
          position: 0,
          conditions: [{ field: 'subscription', op: 'isRegistered' }],
          actions: [{ type: 'setCategory', categoryId: categoryId('system:bills') }],
          createdAt: new Date('2026-10-01T00:00:00Z'),
          updatedAt: new Date('2026-10-01T00:00:00Z'),
        },
      ],
    });
    schedules.listSubscriptions.mockResolvedValueOnce({
      ok: true,
      value: { subscriptions: [{ name: 'Netflix' }] },
    } as never);
    const { sheet } = await open({ description: 'Netflix bulanan' });
    await expect.element(sheet.getByText('Aturan “Langganan streaming” cocok').first()).toBeVisible();
  });

  it('still records when the rules and subscriptions cannot be loaded', async () => {
    vi.mocked(listAutoRules).mockRejectedValueOnce(new Error('offline'));
    schedules.listSubscriptions.mockRejectedValueOnce(new Error('offline'));
    const { sheet, amount } = await open({ description: 'Netflix bulanan' });
    expect(sheet.getByText(/^Aturan “/).elements()).toHaveLength(0);
    await userEvent.fill(amount, '25000');
    await userEvent.click(sheet.getByRole('button', { name: 'Makan & Dapur' }));
    await userEvent.click(sheet.getByRole('button', { name: /^Simpan/ }));
    expect(writes.recordTransaction).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'expense',
        amountMinor: 25_000n,
        description: 'Netflix bulanan',
      }) as unknown,
    });
    toast.dismiss();
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

  it('shows the budget impact once the budget loads, and goes without it when it cannot', async () => {
    budget.getBudgetStatus.mockResolvedValueOnce({
      ok: true,
      value: budgetStatus({ lines: [...RECORD_BUDGET.lines] }),
    });
    const first = await open();
    expect(budget.getBudgetStatus).toHaveBeenCalledWith({ data: {} });
    await userEvent.fill(first.amount, '25000');
    await userEvent.click(first.sheet.getByRole('button', { name: 'Makan & Dapur' }));
    await expect
      .element(first.sheet.getByText(/^Anggaran Makan & Dapur jadi/))
      .toHaveTextContent('Anggaran Makan & Dapur jadi 92% · Rp3.225.000 / 3.500.000');
    await first.screen.unmount();

    budget.getBudgetStatus.mockRejectedValueOnce(new Error('offline'));
    const second = await open();
    await userEvent.fill(second.amount, '25000');
    await userEvent.click(second.sheet.getByRole('button', { name: 'Makan & Dapur' }));
    await expect
      .element(second.sheet.getByRole('button', { name: 'Makan & Dapur' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(second.sheet.getByText(/^Anggaran /).query()).toBeNull();
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

  it('"Pisah tagihan" splits a continued draft with others, records it, and closes (FR-L5)', async () => {
    writes.listDrafts.mockResolvedValueOnce({ ok: true, value: [draft('d-cgv', draftPayload('CGV'))] });
    receivables.getSplitBillContext.mockResolvedValue({ ok: false, code: 'INTERNAL' });
    receivables.recordSplitBill.mockResolvedValue({ ok: true, value: { transactionId: 'tx-9', receivables: [1] } });
    const { sheet, invalidate } = await open();
    await userEvent.click(sheet.getByRole('button', { name: 'Lanjutkan' }));
    await userEvent.click(sheet.getByRole('button', { name: /Pisah tagihan/ }));
    const split = page.getByRole('dialog', { name: 'Pisah tagihan' });
    await expect.element(split).toBeVisible();
    // Its own buttons save: ⌘↵ records nothing while it is open.
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(writes.recordTransaction).not.toHaveBeenCalled();
    await userEvent.click(split.getByRole('button', { name: 'Batal' }));
    await expect.element(page.getByRole('dialog', { name: /^Catat/ })).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: /Pisah tagihan/ }));
    await userEvent.fill(page.getByRole('combobox', { name: 'Nama orang ke-2' }), 'Nadia');
    await userEvent.click(page.getByRole('button', { name: 'Simpan pembagian' }));
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    expect(receivables.recordSplitBill).toHaveBeenCalledWith({
      data: expect.objectContaining({
        transaction: expect.objectContaining({ amountMinor: 9_000n, description: 'CGV' }) as unknown,
      }) as unknown,
    });
    await expect
      .element(page.getByRole('region', { name: 'Notifikasi' }))
      .toMatchTextContent('Tagihan dipisah1 piutang dicatat di Utang & cicilan');
    expect(writes.removeDraft).toHaveBeenCalledWith({ data: { id: 'd-cgv' } });
    expect(invalidate).toHaveBeenCalled();
  });

  it('offers "Pisah tagihan" only for a complete expense recorded now', async () => {
    const { sheet } = await open();
    await userEvent.click(sheet.getByRole('button', { name: /Pisah tagihan/ }));
    await expect.element(sheet.getByRole('alert').first()).toBeVisible();
    await expect.element(page.getByRole('dialog', { name: 'Pisah tagihan' })).not.toBeInTheDocument();
    await userEvent.click(sheet.getByRole('radio', { name: 'Pemasukan' }));
    await expect.element(sheet.getByRole('button', { name: /Pisah tagihan/ })).not.toBeInTheDocument();
  });

  it('keeps a draft and switches to Pemasukan for a short account', async () => {
    writes.saveDraft.mockResolvedValueOnce({ ok: false, code: 'INVALID_TRANSACTION' });
    const { sheet, amount } = await open();
    await userEvent.click(sheet.getByRole('button', { name: 'Rekening' }));
    await userEvent.click(page.getByRole('option', { name: /OVO/ }));
    await userEvent.fill(amount, '100000');
    await expect.element(sheet.getByRole('button', { name: /^Tetap simpan/ })).toBeVisible();
    await userEvent.click(sheet.getByRole('button', { name: 'Sesuaikan saldo' }));
    expect(reconcile.openReconcile).toHaveBeenCalledWith(OVO.id);
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

  it('"Ulangi" makes the saved transaction the first of a monthly repeat with H-1', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T03:00:00Z'));
    schedules.createRecurrence.mockResolvedValueOnce({ ok: true, value: { id: 'rec-1' } });
    const { sheet, amount } = await open();
    await userEvent.fill(amount, '150000');
    await userEvent.click(sheet.getByRole('button', { name: 'Makan & Dapur' }));
    await userEvent.click(sheet.getByRole('button', { name: 'Ulangi' }));
    await expect
      .element(sheet.getByRole('list', { name: 'Jadwal berikutnya' }))
      .toHaveTextContent('15 Nov15 Des15 Jan');
    await userEvent.click(sheet.getByRole('button', { name: /^Simpan/ }));
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    expect(schedules.createRecurrence).toHaveBeenCalledWith({
      data: expect.objectContaining({
        transactionId: 'tx-1',
        freq: 'monthly',
        startOn: '2026-10-15',
        monthDay: 15,
        end: { type: 'never' },
        remindOffsetDays: 1,
        template: expect.objectContaining({ type: 'expense', accountId: BCA.id, amountMinor: 150_000n }) as unknown,
      }) as unknown,
    });
    await expect.element(page.getByRole('region', { name: 'Notifikasi' })).toMatchTextContent('Transaksi tersimpan');
  });

  it('says when the repeat could not be made, keeping the saved transaction; a new entry starts without it', async () => {
    schedules.createRecurrence
      .mockResolvedValueOnce({ ok: false, code: 'INVALID_RECURRENCE' })
      .mockRejectedValueOnce(new Error('offline'));
    const { sheet, amount } = await open();
    await userEvent.click(sheet.getByRole('checkbox', { name: 'Tambah lagi setelah simpan' }));
    for (const round of [1, 2]) {
      await userEvent.fill(amount, '25000');
      await userEvent.click(sheet.getByRole('button', { name: 'Makan & Dapur' }));
      await userEvent.click(sheet.getByRole('button', { name: 'Ulangi' }));
      await userEvent.click(sheet.getByRole('button', { name: /^Simpan/ }));
      await expect.element(sheet).toMatchTextContent(`${String(round)} transaksi tersimpan di sesi ini`);
      await expect.element(sheet.getByRole('button', { name: 'Ulangi' })).toBeVisible();
    }
    const notices = page.getByRole('region', { name: 'Notifikasi' });
    await expect.element(notices).toMatchTextContent('Transaksi tersimpan, tapi pengulangannya gagal dibuat.');
    expect(writes.recordTransaction).toHaveBeenCalledTimes(2);
  });

  it('"Jadwalkan": a future date records nothing and schedules it for the Review queue', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T03:00:00Z'));
    writes.listTransactionDays.mockResolvedValue({ ok: true, value: [] });
    schedules.createRecurrence
      .mockResolvedValueOnce({ ok: false, code: 'INVALID_RECURRENCE' })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, value: { id: 'rec-2' } });
    const { sheet, amount, invalidate } = await open();
    await userEvent.fill(amount, '350000');
    await userEvent.click(sheet.getByRole('button', { name: 'Makan & Dapur' }));
    await userEvent.click(sheet.getByRole('button', { name: 'Tanggal' }));
    await userEvent.click(page.getByRole('button', { name: 'Jadwalkan' }));
    await userEvent.click(page.getByRole('button', { name: 'Selasa, 20 Oktober 2026' }));
    await expect
      .element(sheet.getByRole('status'))
      .toMatchTextContent('Dijadwalkan 20 Okt 2026: belum tercatat, saldo dan anggaran belum berubah.');
    await expect.element(sheet).not.toMatchTextContent('setelah disimpan');
    const schedule = sheet.getByRole('button', { name: /^Jadwalkan/ });
    await userEvent.click(schedule);
    await expect.element(sheet.getByText('Periksa lagi jadwal berulangnya.')).toBeVisible();
    await userEvent.click(schedule);
    await expect.element(sheet.getByText('Transaksi tidak bisa disimpan. Coba lagi.')).toBeVisible();
    await userEvent.click(schedule);
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    expect(writes.recordTransaction).not.toHaveBeenCalled();
    expect(schedules.createRecurrence).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        startOn: '2026-10-20',
        end: { type: 'after', count: 1 },
        remindOffsetDays: 1,
        template: expect.objectContaining({ amountMinor: 350_000n, categoryId: categoryId('system:food') }) as unknown,
      }) as unknown,
    });
    expect(schedules.createRecurrence.mock.lastCall?.[0]).not.toHaveProperty('data.transactionId');
    const notices = page.getByRole('region', { name: 'Notifikasi' });
    await expect.element(notices).toMatchTextContent('Transaksi dijadwalkan');
    await expect.element(notices).toMatchTextContent('Masuk Perlu ditinjau pada 20 Okt 2026.');
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('schedules a continued draft and removes it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T03:00:00Z'));
    writes.listTransactionDays.mockResolvedValue({ ok: true, value: [] });
    writes.listDrafts.mockResolvedValue({
      ok: true,
      value: [draft('d-future', draftPayload('Listrik', { date: '2026-10-25' }))],
    });
    schedules.createRecurrence.mockResolvedValueOnce({ ok: true, value: { id: 'rec-3' } });
    const { sheet } = await open();
    await userEvent.click(sheet.getByRole('button', { name: 'Lanjutkan' }));
    await expect.element(sheet.getByRole('button', { name: /^Jadwalkan/ })).toBeVisible();
    await userEvent.click(sheet.getByRole('button', { name: /^Jadwalkan/ }));
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    expect(writes.removeDraft).toHaveBeenCalledWith({ data: { id: 'd-future' } });
  });

  describe('credit cards (FR-U2, FR-U4)', () => {
    const card = (overrides = {}) => ({
      ok: true,
      value: {
        today: '2026-10-15',
        card: visa({ accountId: CARD.id, ...overrides }),
        debts: [],
        priority: ['installments', 'spending'],
      },
    });

    it('"Pecah jadi cicilan" records the card expense with its plan (hNvip)', async () => {
      debts.getCardPaymentContext.mockResolvedValue(card());
      debts.recordCardInstallment
        .mockResolvedValueOnce({ ok: false, code: 'INVALID_DEBT' })
        .mockResolvedValueOnce({ ok: true, value: { transactionId: 'tx-9', debt: {} } });
      const { sheet } = await open({ accountId: CARD.id, amountMinor: 3_000_000n });
      await userEvent.click(sheet.getByRole('button', { name: 'Makan & Dapur' }));
      const region = sheet.getByRole('region', { name: 'Pecah jadi cicilan' });
      await userEvent.click(region.getByRole('switch'));
      await userEvent.click(sheet.getByRole('button', { name: /^Simpan · cicil 3×/ }));
      await expect.element(sheet.getByText('Periksa lagi data utang atau cicilan.')).toBeVisible();
      expect(debts.recordCardInstallment).toHaveBeenCalledWith({
        data: {
          transaction: expect.objectContaining({
            type: 'expense',
            accountId: CARD.id,
            amountMinor: 3_000_000n,
          }) as unknown,
          tenor: 3,
          monthlyRateBps: 0,
          adminFeeMinor: 0n,
        },
      });
      expect(writes.recordTransaction).not.toHaveBeenCalled();
      await userEvent.click(sheet.getByRole('button', { name: /^Simpan · cicil 3×/ }));
      await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    });

    it('a transfer into a card is recorded with its allocation, in the order and mode chosen (qrRRV)', async () => {
      debts.getCardPaymentContext.mockResolvedValue(card());
      debts.recordCardPayment
        .mockResolvedValueOnce({ ok: false, code: 'INVALID_DEBT' })
        .mockResolvedValueOnce({ ok: true, value: { transactionId: 'tx-10', debts: [] } });
      const { sheet } = await open({ type: 'transfer', toAccountId: CARD.id });
      const region = sheet.getByRole('region', { name: 'Alokasi pembayaran kartu' });
      await expect.element(sheet.getByRole('button', { name: /^Ke:/ })).toBeVisible();
      await expect.element(region).not.toBeInTheDocument();
      await userEvent.fill(sheet.getByRole('textbox', { name: /^Jumlah/ }), '500000');
      await expect.element(region).toBeVisible();
      await userEvent.click(sheet.getByRole('button', { name: /^Simpan/ }));
      await expect.element(sheet.getByText('Periksa lagi data utang atau cicilan.')).toBeVisible();
      expect(debts.recordCardPayment).toHaveBeenLastCalledWith({
        data: {
          transaction: expect.objectContaining({ type: 'transfer', toAccountId: CARD.id }) as unknown,
          mode: 'reduce_amount',
        },
      });
      await userEvent.click(region.getByRole('button', { name: 'Naikkan Tagihan berjalan' }));
      await userEvent.click(sheet.getByRole('button', { name: /^Simpan/ }));
      await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
      expect(debts.recordCardPayment.mock.lastCall?.[0]).toMatchObject({
        data: { priority: ['spending', 'installments'], mode: 'reduce_amount' },
      });
    });

    it('records a plain card expense when the card cannot be loaded', async () => {
      debts.getCardPaymentContext.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
      const { sheet, amount } = await open({ accountId: CARD.id });
      await userEvent.fill(amount, '700000');
      await userEvent.click(sheet.getByRole('button', { name: 'Makan & Dapur' }));
      await expect.element(sheet.getByRole('region', { name: 'Pecah jadi cicilan' })).not.toBeInTheDocument();
      await userEvent.click(sheet.getByRole('button', { name: /^Simpan/ }));
      await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
      expect(writes.recordTransaction).toHaveBeenCalled();
    });
  });
});

describe('Bayar dari tujuan (FR-G4)', () => {
  const food = (sheet: Locator) => userEvent.click(sheet.getByRole('button', { name: 'Makan & Dapur' }));
  const noOffer = async (prefill: RecordPrefill) => {
    const { sheet } = await open(prefill);
    await expect.element(sheet.getByRole('textbox', { name: 'Jumlah' })).toBeVisible();
    expect(sheet.getByRole('region', { name: /^Bayar dari tujuan/ }).query()).toBeNull();
  };

  it('golden (itVPf): "Pakai dana" of STNK pays Rp812.000 from it, marks it Terpakai, and offers to move the rest', async () => {
    goals.spendFromGoal.mockResolvedValueOnce({
      ok: true,
      value: { transactionId: 'tx-stnk', goal: { ...STNK, status: 'used', savedMinor: 38_000n } },
    });
    const { sheet, amount, invalidate, router } = await open({
      type: 'expense',
      goalId: STNK.id,
      description: 'Perpanjang STNK — Samsat Jaksel',
      accountId: BCA.id,
    });
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue();
    const block = sheet.getByRole('region', { name: 'Bayar dari tujuan Perpanjang STNK' });
    await expect.element(block).toMatchTextContent('100% · Rp850.000');
    await expect
      .element(block.getByRole('button', { name: 'Pakai dana tujuan' }))
      .toHaveAttribute('aria-pressed', 'true');
    await userEvent.fill(amount, '812000');
    await food(sheet);
    await expect.element(block).toMatchTextContent(/Sisa Rp38\.000 bisa dipindah ke tujuan lain setelah disimpan\./);
    await userEvent.click(sheet.getByRole('button', { name: /^Simpan/ }));
    expect(goals.spendFromGoal).toHaveBeenCalledWith({
      data: {
        goalId: STNK.id,
        markUsed: true,
        entry: expect.objectContaining({
          type: 'expense',
          accountId: BCA.id,
          amountMinor: 812_000n,
          description: 'Perpanjang STNK — Samsat Jaksel',
        }) as unknown,
      },
    });
    expect(writes.recordTransaction).not.toHaveBeenCalled();
    const region = page.getByRole('region', { name: 'Notifikasi' });
    await expect.element(region.getByText('Perpanjang STNK ditandai Terpakai')).toBeVisible();
    await userEvent.click(region.getByRole('button', { name: 'Pindahkan sisa' }));
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/goals', search: { remainder: STNK.id } }));
    expect(invalidate).toHaveBeenCalled();
    toast.dismiss();
  });

  it('offers the goal an expense names and pays it from the account the goal’s money is in', async () => {
    goals.spendFromGoal.mockResolvedValueOnce({
      ok: true,
      value: { transactionId: 'tx-servis', goal: { ...SERVIS, status: 'used', savedMinor: 0n } },
    });
    const { sheet, amount } = await open();
    await userEvent.fill(amount, '720000');
    await food(sheet);
    await userEvent.fill(sheet.getByRole('textbox', { name: 'Catatan', exact: true }), 'Servis motor besar');
    const block = sheet.getByRole('region', { name: 'Bayar dari tujuan Servis motor' });
    await expect
      .element(block.getByRole('button', { name: 'Pakai dana tujuan' }))
      .toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(block.getByRole('button', { name: 'Pakai dana tujuan' }));
    await expect.element(sheet.getByRole('button', { name: 'Rekening' })).toMatchTextContent(JAGO.displayName);
    await userEvent.click(sheet.getByRole('button', { name: /^Simpan/ }));
    expect(goals.spendFromGoal).toHaveBeenCalledWith({
      data: expect.objectContaining({
        goalId: SERVIS.id,
        entry: expect.objectContaining({ accountId: JAGO.id }) as unknown,
      }) as unknown,
    });
    const region = page.getByRole('region', { name: 'Notifikasi' });
    await expect.element(region.getByText('Servis motor ditandai Terpakai')).toBeVisible();
    expect(region.getByRole('button', { name: 'Pindahkan sisa' }).query()).toBeNull();
    toast.dismiss();
  });

  it('records a plain expense when the goal is declined', async () => {
    const { sheet, amount } = await open();
    await userEvent.fill(amount, '50000');
    await food(sheet);
    await userEvent.fill(sheet.getByRole('textbox', { name: 'Catatan', exact: true }), 'perpanjang stnk');
    const offer = sheet.getByRole('region', { name: 'Bayar dari tujuan Perpanjang STNK' });
    await userEvent.click(offer.getByRole('button', { name: 'Pakai dana tujuan' }));
    // Already on BCA Tahapan, where STNK's money is.
    await expect.element(sheet.getByRole('button', { name: 'Rekening' })).toMatchTextContent(BCA.displayName);
    await userEvent.click(offer.getByRole('button', { name: 'Catat sebagai pengeluaran biasa' }));
    await expect.element(offer).not.toBeInTheDocument();
    await userEvent.click(sheet.getByRole('button', { name: /^Simpan/ }));
    expect(writes.recordTransaction).toHaveBeenCalled();
    expect(goals.spendFromGoal).not.toHaveBeenCalled();
    toast.dismiss();
  });

  it('keeps the sheet open on a refused payment, and forgets the goal for the next entry', async () => {
    goals.spendFromGoal
      .mockResolvedValueOnce({ ok: false, code: 'INVALID_GOAL' })
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce({
        ok: true,
        value: { transactionId: 'tx', goal: { ...STNK, sources: [], savedMinor: 0n } },
      });
    const { sheet, amount } = await open({ goalId: STNK.id });
    await userEvent.fill(amount, '100000');
    await food(sheet);
    await userEvent.click(sheet.getByRole('button', { name: /^Simpan/ }));
    await expect.element(sheet.getByText('Periksa lagi data tujuan tabungan.')).toBeVisible();
    await userEvent.click(sheet.getByRole('button', { name: /^Simpan/ }));
    await expect.element(sheet.getByText('Transaksi tidak bisa disimpan. Coba lagi.')).toBeVisible();
    await userEvent.click(sheet.getByRole('checkbox', { name: 'Tambah lagi setelah simpan' }));
    await userEvent.click(sheet.getByRole('button', { name: /^Simpan/ }));
    await expect.element(sheet.getByRole('region', { name: /^Bayar dari tujuan/ })).not.toBeInTheDocument();
    toast.dismiss();
  });

  it('offers nothing on income', async () => {
    await noOffer({ type: 'income', goalId: STNK.id });
    expect(goals.listGoals).toHaveBeenCalledWith({ data: { status: 'active' } });
  });

  it('offers nothing on a scheduled expense', async () => {
    await noOffer({ goalId: STNK.id, date: '2026-12-01' as LocalDate });
  });

  it('offers nothing when goals are refused', async () => {
    goals.listGoals.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    await noOffer({ goalId: STNK.id });
  });

  it('offers nothing when goals cannot be loaded', async () => {
    goals.listGoals.mockRejectedValueOnce(new TypeError('offline'));
    await noOffer({ goalId: STNK.id });
  });

  it('leaves the account alone for a goal without sources', async () => {
    const bare = { ...STNK, id: 'bare', name: 'Kado', tag: 'kado', sources: [] };
    goals.listGoals.mockResolvedValueOnce({ ok: true, value: [bare] });
    const { sheet } = await open({ goalId: bare.id, accountId: OVO.id });
    await userEvent.click(sheet.getByRole('button', { name: 'Pakai dana tujuan' }));
    await expect.element(sheet.getByRole('button', { name: 'Rekening' })).toMatchTextContent(OVO.displayName);
  });

  it('warns about savings kept wholly in the paying account and switches accounts on request', async () => {
    goals.listGoals.mockResolvedValueOnce({ ok: true, value: [DANA_DARURAT] });
    const { sheet, amount } = await open({ type: 'expense', accountId: JAGO.id });
    await userEvent.fill(amount, '450000');
    await food(sheet);
    const warning = sheet.getByRole('status', { name: 'Rekening dialokasikan ke tujuan' });
    await expect.element(warning).toMatchTextContent('Bank Jago seluruhnya untuk Dana Darurat');
    await userEvent.click(warning.getByRole('button', { name: `Pakai ${BCA.displayName}` }));
    await expect.element(sheet.getByRole('button', { name: 'Rekening' })).toMatchTextContent(BCA.displayName);
  });
});
