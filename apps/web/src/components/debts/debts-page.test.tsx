// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BILL_OVERVIEW,
  debtsOverview,
  MACBOOK,
  OCTOBER_BILL,
  PAID_OVERVIEW,
  visa,
} from '../../../test/debt-fixtures.ts';
import { NADIA, RAKA, receivablesOverview } from '../../../test/receivable-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { DebtsPage, type DebtsPageProps, type DebtsTab } from './debts-page.tsx';

const fake = vi.hoisted(() => ({
  setCardPaymentPriority: vi.fn(),
  createDebt: vi.fn(),
  convertCardTransaction: vi.fn(),
}));
vi.mock('../../server/fn/debts.ts', () => fake);
const receivables = vi.hoisted(() => ({
  recordReceivable: vi.fn(),
  receiveReceivablePayment: vi.fn(),
  writeOffReceivable: vi.fn(),
}));
vi.mock('../../server/fn/receivables.ts', () => receivables);
const tabs = vi.hoisted(() => vi.fn());
const toasts = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { undo: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('@wf/ui/toast', () => toasts);
const record = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../ledger/record-transaction.tsx', () => ({ useRecordTransaction: () => record }));

afterEach(() => {
  vi.clearAllMocks();
});

/** The page with its tab kept in state, as the route keeps it in `?tab`. */
function Page({
  initialTab = 'debts',
  ...props
}: Omit<DebtsPageProps, 'tab' | 'onTabChange'> & { initialTab?: DebtsTab }) {
  const [tab, setTab] = useState<DebtsTab>(initialTab);
  return (
    <DebtsPage
      {...props}
      tab={tab}
      onTabChange={(next) => {
        tabs(next);
        setTab(next);
      }}
    />
  );
}

describe('DebtsPage', () => {
  it('golden exCE7: debt-free with the debt types; a type opens the form on that kind', async () => {
    const { screen } = await renderApp(
      <Page overview={debtsOverview({ cards: [{ ...visa({ balanceMinor: 0n }), transactions: [] }] })} />,
    );
    await expect.element(screen.getByRole('heading', { level: 1, name: 'Utang & cicilan' })).toBeVisible();
    await expect.element(screen.getByText('Tidak ada utang tercatat')).toBeVisible();
    await expect.element(screen.getByText('Kamu bebas utang')).toBeVisible();
    await screen
      .getByRole('list', { name: 'Jenis utang' })
      .getByRole('button', { name: /KPR \/ KPM/ })
      .click();
    await expect.element(screen.getByRole('radio', { name: 'KPR' })).toBeChecked();
    await screen.getByRole('dialog').getByRole('button', { name: 'Batal' }).click();
    // "Catat piutang" is folded into ⋯ in the header below 1024 px, so this is the empty state's own button.
    await screen.getByRole('button', { name: 'Catat piutang' }).click();
    await expect.element(screen.getByRole('dialog', { name: 'Catat piutang' })).toBeVisible();
  });

  it('golden rHTMd: the card bill; "Bayar tagihan" records a transfer, "Ubah jadi cicilan" converts', async () => {
    fake.convertCardTransaction.mockResolvedValue({ ok: true, value: { name: 'Tokopedia' } });
    const { screen, router } = await renderApp(<Page overview={BILL_OVERVIEW} />);
    const invalidate = vi.spyOn(router, 'invalidate').mockResolvedValue();
    await expect.element(screen.getByText('1 tagihan kartu kredit · per 15 Okt 2026')).toBeVisible();
    await screen.getByRole('button', { name: 'Bayar tagihan' }).click();
    expect(record.open).toHaveBeenCalledWith({ type: 'transfer', toAccountId: 'acc-visa', amountMinor: 1_250_000n });
    await screen.getByRole('button', { name: 'Ubah jadi cicilan' }).click();
    const dialog = screen.getByRole('dialog', { name: 'Ubah transaksi jadi cicilan' });
    await expect.element(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Batal' }).click();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('golden A7ttc: the installment, the priority saved or refused, and a saved plan reloads', async () => {
    fake.setCardPaymentPriority
      .mockResolvedValueOnce({ ok: false, code: 'INTERNAL' })
      .mockResolvedValueOnce({ ok: true, value: ['spending', 'installments'] });
    fake.createDebt.mockResolvedValue({ ok: true, value: { name: 'Pinjaman Ibu' } });
    const { screen, router } = await renderApp(<Page overview={PAID_OVERVIEW} initialNew />);
    const invalidate = vi.spyOn(router, 'invalidate').mockResolvedValue();
    const add = screen.getByRole('dialog', { name: 'Tambah utang / cicilan' });
    await add.getByRole('textbox', { name: 'Nama' }).fill('Pinjaman Ibu');
    await add.getByRole('textbox', { name: 'Pokok' }).fill('1000000');
    await add.getByRole('button', { name: 'Simpan cicilan' }).click();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith({
        tone: 'success',
        title: 'Pinjaman Ibu tersimpan di Utang & cicilan',
      });
    });
    expect(invalidate).toHaveBeenCalled();

    await expect.element(screen.getByText('1 cicilan aktif · 1 tagihan berjalan · per 10 Nov 2026')).toBeVisible();
    await expect.element(screen.getByRole('article', { name: 'Tokopedia — Kulkas 2 pintu' })).toBeVisible();
    await screen.getByRole('button', { name: 'Bayar tagihan' }).click();
    expect(record.open).toHaveBeenLastCalledWith({
      type: 'transfer',
      toAccountId: 'acc-visa',
      amountMinor: 1_333_334n,
    });
    const panel = screen.getByRole('region', { name: 'Prioritas pembayaran kartu' });
    await panel.getByRole('button', { name: 'Ubah' }).click();
    await panel.getByRole('button', { name: 'Simpan' }).click();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith({ tone: 'error', title: expect.any(String) as unknown });
    });
    await panel.getByRole('button', { name: 'Simpan' }).click();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenLastCalledWith({ tone: 'success', title: 'Prioritas pembayaran kartu disimpan' });
    });
    await screen.getByRole('button', { name: 'Tambah utang / cicilan' }).click();
    await expect.element(screen.getByRole('radio', { name: 'Paylater' })).toBeChecked();
  });

  it('pays a card without a cycle its bill, one owing only installments what it owes, and hides an idle card', async () => {
    const held = {
      ...visa({ accountId: 'acc-held', name: 'Held', balanceMinor: -3_000_000n, installmentsHeldMinor: 3_000_000n }),
      transactions: OCTOBER_BILL.slice(0, 1),
    };
    const quiet = {
      ...visa({ accountId: 'acc-quiet', name: 'Quiet', balanceMinor: -1_000_000n, installmentsHeldMinor: 1_000_000n }),
      transactions: [],
    };
    const credit = { ...visa({ statementDay: null, balanceMinor: -500_000n }), transactions: [] };
    const { screen } = await renderApp(<Page overview={debtsOverview({ cards: [credit, held, quiet] })} />);
    await expect.element(screen.getByRole('article', { name: 'Tagihan BCA Visa' })).toBeVisible();
    expect(screen.getByRole('article').elements()).toHaveLength(2);
    await screen
      .getByRole('article', { name: 'Tagihan BCA Visa' })
      .getByRole('button', { name: 'Bayar tagihan' })
      .click();
    expect(record.open).toHaveBeenLastCalledWith({ type: 'transfer', toAccountId: 'acc-visa', amountMinor: 500_000n });
    await screen.getByRole('article', { name: 'Tagihan Held' }).getByRole('button', { name: 'Bayar tagihan' }).click();
    expect(record.open).toHaveBeenLastCalledWith({
      type: 'transfer',
      toAccountId: 'acc-held',
      amountMinor: 3_000_000n,
    });
  });

  it('lists a paylater without cards and without the card payment priority', async () => {
    const { screen } = await renderApp(
      <Page overview={debtsOverview({ debts: [{ ...MACBOOK, sourceDate: null }] })} />,
    );
    await expect.element(screen.getByRole('article', { name: 'MacBook Air M4 — iBox' })).toBeVisible();
    await expect.element(screen.getByText('1 cicilan aktif · per 15 Okt 2026')).toBeVisible();
    await expect.element(screen.getByRole('region', { name: 'Prioritas pembayaran kartu' })).not.toBeInTheDocument();
  });

  it('golden KZZZy: debt-free with receivables; the Piutang tab records, receives, and writes off', async () => {
    receivables.recordReceivable.mockResolvedValue({ ok: true, value: { ...NADIA, counterparty: 'Bima Aditya' } });
    receivables.receiveReceivablePayment
      .mockResolvedValueOnce({ ok: true, value: { ...RAKA, status: 'partial' } })
      .mockResolvedValueOnce({ ok: true, value: { ...RAKA, status: 'settled' } });
    receivables.writeOffReceivable.mockResolvedValue({ ok: true, value: NADIA });
    const { screen, router } = await renderApp(
      <Page overview={debtsOverview({ receivables: receivablesOverview() })} />,
    );
    const invalidate = vi.spyOn(router, 'invalidate').mockResolvedValue();
    await expect.element(screen.getByText('Bebas utang · 2 piutang aktif Rp542.500')).toBeVisible();
    await expect
      .element(screen.getByRole('tab', { name: 'Utang & cicilan 0' }))
      .toHaveAttribute('aria-selected', 'true');
    // The debt types offer a receivable too.
    await screen
      .getByRole('list', { name: 'Jenis utang' })
      .getByRole('button', { name: /Piutang/ })
      .click();
    const record = screen.getByRole('dialog', { name: 'Catat piutang' });
    await record.getByRole('combobox', { name: 'Siapa' }).fill('Bima Aditya');
    await record.getByRole('textbox', { name: 'Jumlah' }).fill('500000');
    await record.getByRole('button', { name: 'Catat piutang' }).click();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Piutang Bima Aditya dicatat' });
    });
    expect(invalidate).toHaveBeenCalled();
    expect(tabs).toHaveBeenCalledWith('receivables');
    await expect.element(screen.getByText(/Piutang = uangmu yang ada di orang lain/)).toBeVisible();

    const raka = screen.getByRole('article', { name: 'Raka Pratama' });
    await raka.getByRole('button', { name: 'Terima pembayaran' }).click();
    const receive = screen.getByRole('dialog', { name: 'Terima pembayaran · Raka Pratama' });
    await receive.getByRole('button', { name: 'Rp200.000' }).click();
    await receive.getByRole('button', { name: 'Terima Rp200.000' }).click();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Pembayaran Raka Pratama diterima' });
    });
    await raka.getByRole('button', { name: 'Terima pembayaran' }).click();
    await screen.getByRole('dialog').getByRole('button', { name: 'Batal' }).click();
    await raka.getByRole('button', { name: 'Terima pembayaran' }).click();
    await screen.getByRole('dialog').getByRole('button', { name: 'Terima Rp300.000' }).click();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Piutang Raka Pratama lunas' });
    });

    await screen.getByRole('button', { name: 'Lainnya · Nadia' }).click();
    await screen.getByRole('menuitem', { name: 'Hapuskan' }).click();
    const writeOff = screen.getByRole('dialog', { name: 'Hapuskan piutang Nadia?' });
    await writeOff.getByRole('button', { name: 'Batal' }).click();
    await screen.getByRole('button', { name: 'Lainnya · Nadia' }).click();
    await screen.getByRole('menuitem', { name: 'Hapuskan' }).click();
    await screen.getByRole('dialog').getByRole('button', { name: 'Hapuskan' }).click();
    await vi.waitFor(() => {
      expect(toasts.toast).toHaveBeenCalledWith({ tone: 'success', title: 'Piutang Nadia dihapuskan' });
    });

    // "Catat piutang" is a secondary header action, folded into ⋯ below 1024 px (FR-TB3).
    await screen.getByRole('banner').getByRole('button', { name: 'Aksi lainnya' }).click();
    await screen.getByRole('menuitem', { name: 'Catat piutang' }).click();
    await screen.getByRole('dialog').getByRole('button', { name: 'Batal' }).click();
    await screen.getByRole('tab', { name: 'Utang & cicilan 0' }).click();
    expect(tabs).toHaveBeenLastCalledWith('debts');
  });

  it('adds the receivables to the description of a page with debts and offers recording from an empty tab', async () => {
    const { screen } = await renderApp(
      <Page
        initialTab="receivables"
        overview={debtsOverview({ debts: [{ ...MACBOOK, sourceDate: null }], receivables: receivablesOverview() })}
      />,
    );
    await expect
      .element(screen.getByText('1 cicilan aktif · 2 piutang aktif Rp542.500 · per 15 Okt 2026'))
      .toBeVisible();
    await screen.unmount();
    const empty = await renderApp(<Page initialTab="receivables" overview={debtsOverview()} />);
    await expect.element(empty.screen.getByText('Belum ada piutang')).toBeVisible();
    await empty.screen.getByRole('button', { name: 'Catat piutang' }).last().click();
    await expect.element(empty.screen.getByRole('dialog', { name: 'Catat piutang' })).toBeVisible();
  });
});
