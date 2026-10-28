// SPDX-License-Identifier: AGPL-3.0-only
import type { ActivityEntry } from '@wf/db/activity';
import type { BudgetStatus } from '@wf/db/budgets';
import type { TransactionDetail } from '@wf/db/transactions';
import type { LocalDate } from '@wf/domain/period';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { BCA, categoryId, GOTRADE, LEDGER, OVO, userCategory } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { posting, RECEIPT, transactionDetail } from '../../../test/transaction-fixtures.ts';
import { TransactionDetailPanel, type TransactionDetailPanelProps } from './transaction-detail.tsx';

const server = vi.hoisted(() => ({
  getTransactionDetail: vi.fn(),
  updateTransaction: vi.fn(),
  getBudgetStatus: vi.fn(),
}));
vi.mock('../../server/fn/transactions.ts', () => ({
  getTransactionDetail: server.getTransactionDetail,
  updateTransaction: server.updateTransaction,
}));
vi.mock('../../server/fn/budget.ts', () => ({ getBudgetStatus: server.getBudgetStatus }));
vi.mock('../../server/fn/ledger.ts', () => ({ getReferenceRate: vi.fn() }));
vi.mock('../../server/fn/transactions-write.ts', () => ({
  listTransactionDays: vi.fn().mockResolvedValue({ ok: true, value: [] }),
}));
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock('@wf/ui/toast', () => toasts);
const actions = vi.hoisted(() => ({
  version: 0,
  remove: vi.fn(),
  duplicate: vi.fn(),
  split: vi.fn(),
  changeCategory: vi.fn(),
  moveAccount: vi.fn(),
  addTag: vi.fn(),
  copyAmount: vi.fn(),
}));
vi.mock('./transaction-actions.tsx', () => ({ useTransactionActions: () => actions }));
/** The repeat section is tested on its own; here only where and with what it shows. */
const repeat = vi.hoisted(() => {
  const state: { value: object | null; reload: () => void } = { value: null, reload: vi.fn() };
  return state;
});
vi.mock('./recurrence-section.tsx', () => ({
  useTransactionRecurrence: () => ({ recurrence: repeat.value, reload: repeat.reload }),
  RecurrenceBadge: () => <span>repeat badge</span>,
  RecurrenceSection: (props: { route: string; onChanged: () => void }) => (
    <section aria-label="repeat" data-route={props.route}>
      <button type="button" onClick={props.onChanged}>
        repeat changed
      </button>
    </section>
  ),
}));
/** The attachments section is tested on its own. */
vi.mock('./attachments.tsx', () => ({
  Attachments: (props: { readOnly: boolean; label: string; onChanged: () => void }) => (
    <section aria-label="attachments" data-read-only={String(props.readOnly)} data-label={props.label}>
      <button type="button" onClick={props.onChanged}>
        attachment added
      </button>
    </section>
  ),
}));

const KOPI = userCategory({ id: 'c-kopi', name: 'Kopi', color: 'orange' });
const ledger = { ...LEDGER, categories: [...LEDGER.categories, KOPI] };
const at = (iso: string) => new Date(iso);
const entry = (action: ActivityEntry['action'], meta: ActivityEntry['meta'] = {}, iso = '2026-10-15T05:41:00Z') => ({
  action,
  meta,
  at: at(iso),
});

/** Only the fields the budget bar reads. */
const budget = (usedBps: number | null, start = '2026-10-01', end = '2026-10-31') =>
  ({
    ok: true,
    value: {
      period: { start, end },
      baseCurrency: 'IDR',
      lines: [{ categoryId: KOPI.id, usedBps, limitMinor: 2_000_000n }],
    } as unknown as BudgetStatus,
  }) as const;

async function renderPanel(detail: TransactionDetail, props: Partial<TransactionDetailPanelProps> = {}) {
  server.getTransactionDetail.mockResolvedValue({ ok: true, value: detail });
  const onClose = vi.fn();
  const result = await renderApp(
    <TransactionDetailPanel
      id={detail.id}
      ledger={ledger}
      timeZone="Asia/Jakarta"
      today={'2026-10-15' as LocalDate}
      variant="aside"
      onClose={onClose}
      {...props}
    />,
  );
  return { ...result, onClose };
}

afterEach(() => {
  vi.clearAllMocks();
  repeat.value = null;
});

describe('TransactionDetailPanel', () => {
  it('shows an expense with its category, budget, tags, note, actions, and history', async () => {
    server.getBudgetStatus.mockResolvedValue(budget(5_600));
    const detail = transactionDetail('tx-1', {
      merchant: 'Shopee',
      description: 'Kabel data',
      note: 'Untuk kantor',
      categoryId: KOPI.id,
      source: 'quick',
      splitParentId: 'tx-0',
      tags: ['kantor', 'kopi'],
      postings: [posting(BCA.id, -389_000n)],
      activity: [
        entry('created', { source: 'quick' }, '2026-10-15T05:41:00Z'),
        entry('created'),
        entry('updated', { fields: ['attachments', 'note'] }),
        entry('updated', { fields: ['tags'] }),
        entry('updated', { fields: ['categoryId'] }),
        entry('updated', { fields: ['accountId'] }),
        entry('updated', { fields: ['tags', 'note'] }),
        entry('updated', { fields: 'note' }),
        entry('deleted'),
        entry('restored'),
        entry('duplicated'),
        entry('split'),
        entry('merged', {}, '2026-10-16T01:00:00Z'),
      ],
    });
    const { screen, onClose } = await renderPanel(detail);
    expect(server.getTransactionDetail).toHaveBeenCalledWith({ data: { id: 'tx-1' } });
    await expect.element(screen.getByRole('heading', { name: 'Detail transaksi' })).toBeVisible();
    await expect.element(screen.getByRole('heading', { name: 'Shopee' })).toBeVisible();
    await expect.element(screen.getByText('Kabel data')).toBeVisible();
    await expect.element(screen.getByText('−Rp389.000')).toBeVisible();
    await expect.element(screen.getByText('Tercatat')).toBeVisible();
    await expect.element(screen.getByText('via Catat Cepat')).toBeVisible();
    await expect.element(screen.getByText('Bagian dari transaksi yang dipisah.')).toBeVisible();
    await expect.element(screen.getByRole('definition').nth(0)).toHaveTextContent('Kopi');
    await expect.element(screen.getByRole('definition').nth(1)).toHaveTextContent('BCA Tahapan');
    await expect.element(screen.getByRole('definition').nth(2)).toMatchTextContent(/15 Okt 2026 · 12[.:]41$/);
    await expect.element(screen.getByRole('definition').nth(3)).toHaveTextContent('Untuk kantor');
    await expect.element(screen.getByRole('definition').nth(4)).toHaveTextContent('#kantor#kopi');
    await expect
      .element(screen.getByRole('region', { name: 'attachments' }))
      .toHaveAttribute('data-read-only', 'false');
    await expect.element(screen.getByRole('region', { name: 'attachments' })).toHaveAttribute('data-label', 'Shopee');

    const meter = screen.getByRole('meter', { name: 'Anggaran kategori ini' });
    await expect.element(meter).toHaveAttribute('aria-valuenow', '56');
    expect(meter.element().querySelector('rect')?.getAttribute('class')).toBe('fill-violet');
    await expect
      .element(screen.getByRole('region', { name: 'Anggaran kategori ini' }))
      .toHaveTextContent('56% dari anggaran Kopi (Rp2.000.000)');

    const history = screen.getByRole('region', { name: 'Riwayat' }).getByRole('listitem');
    expect(history.elements().map((item) => item.querySelector('span > span')?.textContent)).toEqual([
      'Diubah',
      'Dipisah jadi beberapa bagian',
      'Diduplikat',
      'Dipulihkan',
      'Dihapus',
      'Diubah',
      'Diubah',
      'Rekening diubah',
      'Kategori diubah',
      'Tag diubah',
      'Lampiran diubah',
      'Dicatat via Catat Transaksi',
      'Dicatat via Catat Cepat',
    ]);
    await expect.element(history.first().getByRole('time')).toMatchTextContent(/^16 Okt · 08[.:]00$/);

    await userEvent.click(screen.getByRole('button', { name: 'Duplikat' }));
    expect(actions.duplicate).toHaveBeenCalledWith('tx-1');
    await userEvent.click(screen.getByRole('button', { name: 'Pisah' }));
    expect(actions.split).toHaveBeenCalledWith('tx-1');
    await userEvent.click(screen.getByRole('button', { name: 'Hapus' }));
    expect(actions.remove).toHaveBeenCalledWith([expect.objectContaining({ id: 'tx-1', amountMinor: -389_000n })]);
    await userEvent.click(screen.getByRole('button', { name: 'Tutup' }));
    expect(onClose).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole('button', { name: 'attachment added' }));
    await vi.waitFor(() => {
      expect(server.getTransactionDetail).toHaveBeenCalledTimes(2);
    });
  });

  it('shows the repeat of a recurring transaction and its history', async () => {
    repeat.value = { id: 'rec-1', status: 'active' };
    const detail = transactionDetail('tx-r', {
      type: 'transfer',
      categoryId: null,
      postings: [posting(BCA.id, -3_000_000n), posting(OVO.id, 3_000_000n)],
      activity: [
        entry('recurrence_set', { freq: 'monthly', monthDay: 14 }, '2026-10-14T12:31:00Z'),
        entry('recurrence_set', { freq: 'weekly', weekday: 4 }, '2026-10-14T12:32:00Z'),
        entry('recurrence_set', { freq: 'yearly' }, '2026-10-14T12:33:00Z'),
        entry('recurrence_stopped', { deleted: 3 }, '2026-10-17T03:12:00Z'),
        entry('recurrence_resumed', {}, '2026-10-17T03:13:00Z'),
      ],
    });
    const { screen } = await renderPanel(detail);
    await expect.element(screen.getByText('repeat badge')).toBeVisible();
    await expect
      .element(screen.getByRole('region', { name: 'repeat' }))
      .toHaveAttribute('data-route', 'BCA Tahapan → OVO');
    const history = screen.getByRole('region', { name: 'Riwayat' }).getByRole('listitem');
    await expect.element(history.first()).toBeVisible();
    expect(history.elements().map((item) => item.querySelector('span > span')?.textContent)).toEqual([
      'Pengulangan dinyalakan lagi',
      'Pengulangan dihentikan · 3 jadwal dihapus',
      'Diulang tiap tahun',
      'Diulang tiap minggu, hari Kamis',
      'Diulang tiap bulan, tgl 14',
    ]);
    await userEvent.click(screen.getByRole('button', { name: 'repeat changed' }));
    expect(repeat.reload).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(server.getTransactionDetail).toHaveBeenCalledTimes(2);
    });
    await screen.unmount();

    // An entry on an unknown account, and a transfer between unknown accounts.
    const { screen: entryPanel } = await renderPanel(
      transactionDetail('tx-e', { categoryId: KOPI.id, postings: [posting('acc-gone', -1n)] }),
    );
    await expect.element(entryPanel.getByRole('region', { name: 'repeat' })).toHaveAttribute('data-route', '');
    await entryPanel.unmount();
    const { screen: unknown } = await renderPanel(
      transactionDetail('tx-u', {
        type: 'transfer',
        categoryId: null,
        postings: [posting('acc-gone', -1n), posting('acc-lost', 1n)],
      }),
    );
    await expect.element(unknown.getByRole('region', { name: 'repeat' })).toHaveAttribute('data-route', ' → ');
    await unknown.unmount();
    const { screen: account } = await renderPanel(
      transactionDetail('tx-a', { categoryId: KOPI.id, postings: [posting(BCA.id, -1n)] }),
    );
    await expect.element(account.getByRole('region', { name: 'repeat' })).toHaveAttribute('data-route', 'BCA Tahapan');
  });

  it('marks a budget over its limit as full and red', async () => {
    server.getBudgetStatus.mockResolvedValue(budget(12_340));
    const { screen } = await renderPanel(transactionDetail('tx-1', { categoryId: KOPI.id }));
    const meter = screen.getByRole('meter');
    await expect.element(meter).toHaveAttribute('aria-valuenow', '100');
    expect(meter.element().querySelector('rect')?.getAttribute('class')).toBe('fill-red');
    await expect.element(screen.getByText(/123% dari anggaran Kopi/)).toBeVisible();
  });

  it('shows no budget without a line, a usage, a budget for that date, or a loaded budget', async () => {
    const statuses = [
      budget(null),
      { ok: true, value: { ...budget(10).value, lines: [] } },
      budget(10, '2026-10-16'),
      budget(10, '2026-09-01', '2026-09-30'),
      { ok: false, code: 'INTERNAL' },
    ];
    for (const status of statuses) {
      server.getBudgetStatus.mockResolvedValue(status);
      const { screen } = await renderPanel(transactionDetail('tx-1', { categoryId: KOPI.id }));
      await expect.element(screen.getByRole('heading', { name: 'Riwayat' })).not.toBeInTheDocument();
      await expect.element(screen.getByRole('heading', { name: /Kopi|Makan/ })).toBeVisible();
      await vi.waitFor(() => {
        expect(server.getBudgetStatus).toHaveBeenCalled();
      });
      await expect.element(screen.getByRole('meter')).not.toBeInTheDocument();
      await screen.unmount();
      server.getBudgetStatus.mockClear();
    }
  });

  it('drops a detail and a budget that arrive after closing', async () => {
    const budgetLater = Promise.withResolvers<unknown>();
    server.getBudgetStatus.mockReturnValue(budgetLater.promise);
    const { screen } = await renderPanel(transactionDetail('tx-1', { categoryId: KOPI.id }));
    await expect.element(screen.getByRole('heading', { name: 'Kopi' })).toBeVisible();
    const detailLater = Promise.withResolvers<unknown>();
    server.getTransactionDetail.mockReturnValue(detailLater.promise);
    await userEvent.click(screen.getByRole('button', { name: 'attachment added' }));
    await screen.unmount();
    budgetLater.resolve(budget(10));
    detailLater.resolve({ ok: true, value: transactionDetail('tx-1') });
    await Promise.all([budgetLater.promise, detailLater.promise]);
  });

  it('shows a transfer: from, to with the amount received, fee, and FX difference', async () => {
    const detail = transactionDetail('tx-2', {
      type: 'transfer',
      categoryId: null,
      source: 'manual',
      postings: [
        posting(BCA.id, -3_000_000n),
        posting(GOTRADE.id, 18_210n, { currency: 'USD' }),
        posting(BCA.id, -6_500n, { role: 'fee', categoryId: categoryId('system:bank_fee') }),
      ],
      transfer: {
        sentMinor: 3_000_000n,
        sentCurrency: 'IDR',
        receivedMinor: 18_210n,
        receivedCurrency: 'USD',
        referenceRate: '16350',
        rateBase: 'USD',
        rateQuote: 'IDR',
        rateSource: 'frankfurter',
        rateAsOf: '2026-10-15' as LocalDate,
        fxDiffBaseMinor: -22_665n,
      },
    });
    const { screen } = await renderPanel(detail, { variant: 'sheet' });
    await expect.element(screen.getByRole('heading', { name: 'Transfer' })).toBeVisible();
    await expect.element(screen.getByRole('heading', { name: 'Detail transaksi' })).not.toBeInTheDocument();
    await expect.element(screen.getByText('via Catat Transaksi')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Pisah' })).not.toBeInTheDocument();
    await expect.element(screen.getByRole('definition').nth(0)).toHaveTextContent('BCA Tahapan');
    await expect.element(screen.getByRole('definition').nth(1)).toHaveTextContent('GotradeUS$182,10');
    await expect.element(screen.getByRole('definition').nth(2)).toHaveTextContent('Rp6.500 · Biaya bank');
    await expect.element(screen.getByRole('definition').nth(3)).toHaveTextContent('−22.665');
    await expect.element(screen.getByRole('definition').nth(5)).toHaveTextContent('Belum ada tag');
    expect(server.getBudgetStatus).not.toHaveBeenCalled();
  });

  it('shows a same-currency transfer without a received amount, fee category, or FX difference', async () => {
    const detail = transactionDetail('tx-3', {
      type: 'transfer',
      categoryId: null,
      postings: [posting(BCA.id, -500_000n), posting(OVO.id, 500_000n), posting(BCA.id, -2_500n, { role: 'fee' })],
      transfer: {
        sentMinor: 500_000n,
        sentCurrency: 'IDR',
        receivedMinor: 500_000n,
        receivedCurrency: 'IDR',
        referenceRate: null,
        rateBase: null,
        rateQuote: null,
        rateSource: null,
        rateAsOf: null,
        fxDiffBaseMinor: 0n,
      },
    });
    const { screen } = await renderPanel(detail);
    await expect.element(screen.getByRole('definition').nth(1)).toHaveTextContent('OVO');
    await expect.element(screen.getByRole('definition').nth(2)).toHaveTextContent('Rp2.500');
    await expect.element(screen.getByText('Selisih kurs')).not.toBeInTheDocument();
    await screen.unmount();

    const { screen: bare } = await renderPanel(
      transactionDetail('tx-4', { type: 'transfer', categoryId: null, postings: [posting(BCA.id, 100n)] }),
    );
    await expect.element(bare.getByRole('heading', { name: 'Transfer' })).toBeVisible();
    await expect.element(bare.getByText('Biaya', { exact: true })).not.toBeInTheDocument();
  });

  it('shows a deleted, uncategorized income read-only', async () => {
    // A deleted transaction offers no repeat to stop.
    repeat.value = { id: 'rec-1', status: 'active' };
    const detail = transactionDetail('tx-5', {
      type: 'income',
      description: 'Refund',
      categoryId: null,
      source: 'import',
      deletedAt: at('2026-10-16T00:00:00Z'),
      postings: [posting('acc-gone', 50_000n)],
      attachments: [RECEIPT],
    });
    const { screen } = await renderPanel(detail);
    await expect.element(screen.getByRole('heading', { name: 'Refund' })).toBeVisible();
    await expect.element(screen.getByText('Terhapus')).toBeVisible();
    await expect.element(screen.getByText(/sudah dihapus/)).toBeVisible();
    await expect.element(screen.getByText('Rp50.000')).toBeVisible();
    await expect.element(screen.getByRole('button', { name: 'Ubah' })).not.toBeInTheDocument();
    await expect.element(screen.getByRole('definition').nth(0)).toHaveTextContent('Belum dikategorikan');
    await expect.element(screen.getByRole('definition').nth(1)).toHaveTextContent('');
    await expect.element(screen.getByRole('region', { name: 'attachments' })).toHaveAttribute('data-read-only', 'true');
    await expect.element(screen.getByText('repeat badge')).toBeVisible();
    await expect.element(screen.getByRole('region', { name: 'repeat' })).not.toBeInTheDocument();
  });

  it('explains a detail that cannot be loaded', async () => {
    server.getTransactionDetail.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
    const loading = Promise.withResolvers<unknown>();
    server.getTransactionDetail.mockReturnValueOnce(loading.promise);
    const { screen } = await renderApp(
      <TransactionDetailPanel
        id="tx-x"
        ledger={ledger}
        timeZone="Asia/Jakarta"
        today={'2026-10-15' as LocalDate}
        variant="sheet"
        onClose={vi.fn()}
      />,
    );
    await expect.element(screen.getByText('Memuat transaksi…')).toBeVisible();
    loading.resolve({ ok: false, code: 'NOT_FOUND' });
    await expect.element(screen.getByText('Detail transaksi gagal dimuat')).toBeVisible();
    await expect.element(screen.getByText('Data ini sudah tidak ada. Muat ulang halaman.')).toBeVisible();
  });

  it('edits in place with the Record Transaction form', async () => {
    server.getBudgetStatus.mockResolvedValue({ ok: false, code: 'INTERNAL' });
    server.updateTransaction
      .mockResolvedValueOnce({ ok: false, code: 'PERIOD_CLOSED' })
      .mockResolvedValueOnce({ ok: true, value: { id: 'tx-1' } });
    const { screen, router } = await renderPanel(transactionDetail('tx-1', { description: 'Makan siang' }));
    const invalidate = vi.spyOn(router, 'invalidate').mockResolvedValue();
    await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
    await expect.element(screen.getByRole('textbox', { name: 'Jumlah' })).toHaveValue('10.000');
    await userEvent.click(screen.getByRole('button', { name: 'Batal' }));
    await expect.element(screen.getByRole('heading', { name: 'Makan siang' })).toBeVisible();
    expect(server.getTransactionDetail).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole('button', { name: 'Ubah' }));
    const save = screen.getByRole('button', { name: 'Simpan perubahan' });
    await userEvent.click(save);
    expect(server.updateTransaction).toHaveBeenCalledWith({
      data: {
        id: 'tx-1',
        input: expect.objectContaining({ amountMinor: 10_000n, description: 'Makan siang' }) as unknown,
      },
    });
    await expect.element(screen.getByRole('alert')).toBeVisible();
    await userEvent.click(save);
    await expect.element(screen.getByRole('heading', { name: 'Makan siang' })).toBeVisible();
    expect(toasts.toast).toHaveBeenCalledWith({ title: 'Perubahan tersimpan' });
    expect(invalidate).toHaveBeenCalledOnce();
    expect(server.getTransactionDetail).toHaveBeenCalledTimes(2);
  });

  it('shows the email evidence behind a Gmail-recorded transaction, masked while balances are hidden', async () => {
    const detail = transactionDetail('tx-g', {
      categoryId: KOPI.id,
      gmailEvidence: {
        kind: 'gmail',
        logId: 'log-1',
        messageId: 'msg/1#a',
        from: 'billing@pln.test',
        subject: 'Tagihan PLN Oktober',
        excerpt: 'Pembayaran Rp350.000 berhasil',
        tags: [],
        errorCode: null,
        extraction: {
          amountMinor: 350_000n,
          occurredAt: new Date('2026-10-15T02:00:00Z'),
          merchant: 'PLN',
          currency: 'IDR',
          accountId: BCA.id,
          categoryId: KOPI.id,
          confidence: { amount: 97, date: 90, merchant: 80, currency: 97, account: 70, category: 60 },
        },
      },
    });
    const { screen } = await renderPanel(detail);
    await userEvent.click(screen.getByText('Bukti email'));
    await expect.element(screen.getByText('billing@pln.test · Tagihan PLN Oktober')).toBeVisible();
    await expect.element(screen.getByText('Pembayaran Rp350.000 berhasil')).toBeVisible();
    await expect
      .element(screen.getByRole('link', { name: 'Buka di Gmail' }))
      .toHaveAttribute('href', 'https://mail.google.com/mail/u/0/#all/msg%2F1%23a');
    await screen.unmount();

    server.getTransactionDetail.mockResolvedValue({ ok: true, value: detail });
    const { screen: hidden } = await renderApp(
      <TransactionDetailPanel
        id={detail.id}
        ledger={ledger}
        timeZone="Asia/Jakarta"
        today={'2026-10-15' as LocalDate}
        variant="aside"
        onClose={vi.fn()}
      />,
      { preferences: { balancesHidden: true } },
    );
    await userEvent.click(hidden.getByText('Bukti email'));
    await expect.element(hidden.getByText(/97%/)).toBeVisible();
    expect(document.body.textContent).not.toContain('billing@pln.test');
    expect(document.body.textContent).not.toContain('Pembayaran Rp350.000');
  });
});
