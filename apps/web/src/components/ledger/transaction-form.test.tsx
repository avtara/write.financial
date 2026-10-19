// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { BCA, categoryId, GOTRADE, JAGO, LEDGER, OVO } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import type { RecordTransactionInput } from '../../server/fn/transactions-write.ts';
import { emptyValues, type TransactionFormValues } from './transaction-draft.ts';
import { TransactionForm, TransactionFormFields } from './transaction-form.tsx';
import { useTransactionForm } from './use-transaction-form.ts';

const server = vi.hoisted(() => ({
  getReferenceRate: vi.fn(),
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listTags: vi.fn(),
}));
vi.mock('../../server/fn/ledger.ts', () => server);
vi.mock('../../server/fn/transactions-write.ts', () => ({
  listTransactionDays: vi.fn().mockResolvedValue({ ok: true, value: [] }),
}));

const TODAY = '2026-10-19' as LocalDate;
const ZONE = 'Asia/Jakarta';

function values(overrides: Partial<TransactionFormValues> = {}): TransactionFormValues {
  return { ...emptyValues({ accountId: BCA.id, date: TODAY, time: '09:30' }), ...overrides };
}

async function renderForm({
  mode = 'create',
  initial = values(),
  onSubmit = vi.fn<(input: RecordTransactionInput) => Promise<string | null>>().mockResolvedValue(null),
  onCancel = vi.fn(),
}: {
  mode?: 'create' | 'edit';
  initial?: TransactionFormValues;
  onSubmit?: (input: RecordTransactionInput) => Promise<string | null>;
  onCancel?: () => void;
} = {}) {
  const { screen } = await renderApp(
    <TransactionForm
      mode={mode}
      initial={initial}
      data={LEDGER}
      locale="id"
      timeZone={ZONE}
      today={TODAY}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />,
  );
  return { screen, onSubmit, onCancel, amount: screen.getByRole('textbox', { name: 'Jumlah' }) };
}

function Fields({
  initial,
  onRecordIncomeFirst,
  onAdjustBalance,
}: {
  readonly initial: TransactionFormValues;
  readonly onRecordIncomeFirst?: (id: string) => void;
  readonly onAdjustBalance?: (id: string) => void;
}) {
  const form = useTransactionForm({ initial, data: LEDGER, locale: 'id' });
  return (
    <TransactionFormFields
      form={form}
      data={LEDGER}
      locale="id"
      timeZone={ZONE}
      today={TODAY}
      {...(onRecordIncomeFirst === undefined ? {} : { onRecordIncomeFirst })}
      {...(onAdjustBalance === undefined ? {} : { onAdjustBalance })}
    />
  );
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('TransactionForm', () => {
  it('shows what is missing before saving', async () => {
    const { screen, onSubmit } = await renderForm({ initial: values({ accountId: null }) });
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }));
    expect(onSubmit).not.toHaveBeenCalled();
    await expect.element(screen.getByText('3 isian perlu dilengkapi')).toBeVisible();
    await expect
      .element(screen.getByRole('textbox', { name: 'Jumlah' }))
      .toHaveAccessibleDescription('Masukkan jumlah lebih dari 0');
    await expect
      .element(screen.getByRole('group', { name: 'Kategori' }))
      .toHaveAccessibleDescription('Pilih satu kategori');
    await expect
      .element(screen.getByRole('button', { name: 'Rekening' }))
      .toHaveAccessibleDescription('Pilih rekening');
    await expect.element(screen.getByRole('button', { name: 'Rekening' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('records an expense with ⌘↵ and starts over', async () => {
    const { screen, onSubmit, amount } = await renderForm();
    await expect.element(amount).toHaveFocus();
    await userEvent.fill(amount, '25000');
    await expect
      .element(screen.getByText(/^Saldo BCA Tahapan jadi/))
      .toMatchTextContent('Saldo BCA Tahapan jadi Rp42.785.000 setelah disimpan.');
    await userEvent.click(screen.getByRole('button', { name: '+10.000' }));
    await expect.element(amount).toHaveValue('35.000');
    await userEvent.click(screen.getByRole('button', { name: 'Makan & Dapur' }));
    await userEvent.click(screen.getByRole('button', { name: 'Rekening' }));
    await userEvent.click(page.getByRole('option', { name: /Bank Jago/ }));
    await expect.element(screen.getByRole('button', { name: 'Rekening' })).toMatchTextContent('Bank Jago');
    await userEvent.fill(screen.getByRole('textbox', { name: 'Catatan', exact: true }), ' makan siang ');
    await userEvent.click(screen.getByRole('combobox', { name: 'Tag' }));
    await userEvent.keyboard('kantor{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Catatan pribadi' }));
    const note = screen.getByRole('textbox', { name: 'Catatan pribadi' });
    await expect.element(note).toHaveAccessibleDescription('Tersimpan terenkripsi, hanya kamu yang bisa membacanya.');
    await userEvent.fill(note, 'rahasia');
    await userEvent.click(amount);
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'expense',
        accountId: JAGO.id,
        amountMinor: 35_000n,
        categoryId: categoryId('system:food'),
        description: 'makan siang',
        note: 'rahasia',
        tags: ['kantor'],
        source: 'manual',
        occurredAt: new Date('2026-10-19T02:30:00Z'),
      }),
    );
    await expect.element(amount).toHaveValue('');
    await expect.element(screen.getByRole('button', { name: 'Rekening' })).toMatchTextContent('BCA Tahapan');
  });

  it('shows why saving failed, saves once while pending, and keeps the values when editing', async () => {
    const pending = Promise.withResolvers<string | null>();
    const onSubmit = vi
      .fn<(input: RecordTransactionInput) => Promise<string | null>>()
      .mockResolvedValueOnce('Transaksi tidak bisa disimpan. Coba lagi.')
      .mockReturnValueOnce(pending.promise);
    const { screen, amount } = await renderForm({
      mode: 'edit',
      initial: values({ amountMinor: 50_000n, categoryId: categoryId('system:food'), note: 'lama' }),
      onSubmit,
    });
    await expect.element(screen.getByRole('textbox', { name: 'Catatan pribadi' })).toHaveValue('lama');
    const save = screen.getByRole('button', { name: 'Simpan perubahan' });
    await userEvent.click(save);
    await expect.element(screen.getByRole('alert')).toMatchTextContent('Transaksi tidak bisa disimpan. Coba lagi.');
    await userEvent.click(amount);
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert').query()).toBeNull();
    pending.resolve(null);
    await expect.element(save).toBeEnabled();
    await expect.element(amount).toHaveValue('50.000');
  });

  it('cancels', async () => {
    const { screen, onCancel } = await renderForm();
    await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('records an income into an account, with its own wording', async () => {
    const { screen, amount } = await renderForm({ initial: values({ categoryId: categoryId('system:food') }) });
    await userEvent.click(screen.getByRole('radio', { name: 'Pemasukan' }));
    await expect.element(screen.getByRole('group', { name: 'Sumber pemasukan' })).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Masuk ke rekening' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Lihat semua' }));
    await expect.element(page.getByPlaceholder('Cari sumber pemasukan…')).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await userEvent.fill(amount, '1000000');
    await expect.element(screen.getByText(/^Saldo BCA Tahapan jadi/)).toMatchTextContent('Rp43.810.000');
  });

  it('records a transfer, labelling what is sent in another currency', async () => {
    server.getReferenceRate.mockResolvedValue({ ok: true, value: null });
    const { screen } = await renderForm({ initial: values({ amountMinor: 100_000n }) });
    await userEvent.click(screen.getByRole('radio', { name: 'Transfer' }));
    await expect.element(screen.getByText('Dari → ke')).toBeVisible();
    expect(screen.getByText(/^Saldo BCA Tahapan jadi/).query()).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Ke: Pilih rekening' }));
    await userEvent.click(page.getByRole('option', { name: /Gotrade/ }));
    await expect.element(screen.getByRole('textbox', { name: 'Dikirim · IDR' })).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Tanggal' })).toBeVisible();
  });

  it('offers no quick amounts outside rupiah and uses the base currency without an account', async () => {
    const { screen } = await renderForm({ initial: values({ accountId: GOTRADE.id }) });
    expect(screen.getByRole('button', { name: /^\+/ }).query()).toBeNull();
    const none = await renderForm({ initial: values({ accountId: null }) });
    await expect.element(none.screen.getByRole('button', { name: '+10.000' })).toBeVisible();
  });

  it('warns about an insufficient balance and saves anyway', async () => {
    const { screen, onSubmit } = await renderForm({
      initial: values({ accountId: OVO.id, amountMinor: 100_000n, categoryId: categoryId('system:food') }),
    });
    const warning = screen.getByRole('status');
    await expect.element(warning).toMatchTextContent('Saldo OVO kurang Rp14.000');
    await expect
      .element(warning)
      .toMatchTextContent('Saldo tercatat Rp86.000, pengeluaran Rp100.000. Mungkin ada pemasukan yang belum dicatat.');
    expect(screen.getByRole('button', { name: 'Catat pemasukan dulu' }).query()).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Tetap simpan' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

describe('TransactionFormFields', () => {
  it('offers recording an income first or adjusting the balance of a short account', async () => {
    const onRecordIncomeFirst = vi.fn();
    const onAdjustBalance = vi.fn();
    const { screen } = await renderApp(
      <Fields
        initial={values({
          type: 'transfer',
          accountId: OVO.id,
          toAccountId: BCA.id,
          amountMinor: 80_000n,
          feeMinor: 10_000n,
        })}
        onRecordIncomeFirst={onRecordIncomeFirst}
        onAdjustBalance={onAdjustBalance}
      />,
    );
    await expect.element(screen.getByRole('status')).toMatchTextContent('transfer + biaya Rp90.000');
    await userEvent.click(screen.getByRole('button', { name: 'Catat pemasukan dulu' }));
    expect(onRecordIncomeFirst).toHaveBeenCalledWith(OVO.id);
    await userEvent.click(screen.getByRole('button', { name: 'Sesuaikan saldo' }));
    expect(onAdjustBalance).toHaveBeenCalledWith(OVO.id);
  });

  it('leaves out "Catat pemasukan dulu" without its handler', async () => {
    const adjust = await renderApp(
      <Fields initial={values({ accountId: OVO.id, amountMinor: 100_000n })} onAdjustBalance={vi.fn()} />,
    );
    await expect.element(adjust.screen.getByRole('button', { name: 'Sesuaikan saldo' })).toBeVisible();
    expect(adjust.screen.getByRole('button', { name: 'Catat pemasukan dulu' }).query()).toBeNull();
  });

  it('leaves out "Sesuaikan saldo" without its handler', async () => {
    const income = await renderApp(
      <Fields initial={values({ accountId: OVO.id, amountMinor: 100_000n })} onRecordIncomeFirst={vi.fn()} />,
    );
    await expect.element(income.screen.getByRole('button', { name: 'Catat pemasukan dulu' })).toBeVisible();
    expect(income.screen.getByRole('button', { name: 'Sesuaikan saldo' }).query()).toBeNull();
  });
});
