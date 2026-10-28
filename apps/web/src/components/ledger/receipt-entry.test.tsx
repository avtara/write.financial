// SPDX-License-Identifier: AGPL-3.0-only
import type { ReceiptView } from '@wf/db/receipts';
import type { LocalDate } from '@wf/domain/period';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { budgetStatus, RECORD_BUDGET } from '../../../test/budget-fixtures.ts';
import { BCA, CATEGORIES, TAGS, categoryId } from '../../../test/ledger-fixtures.ts';
import { flushReact, renderApp } from '../../../test/render.tsx';
import { ReceiptEntry } from './receipt-entry.tsx';
const server = vi.hoisted(() => ({
  uploadReceipt: vi.fn(),
  getReceipt: vi.fn(),
  cancelReceipt: vi.fn(),
  prepareManualReceipt: vi.fn(),
  confirmReview: vi.fn(),
  listAccounts: vi.fn(),
  removeTransactions: vi.fn(),
  listCategories: vi.fn(),
  listTags: vi.fn(),
  getBudgetStatus: vi.fn(),
}));
vi.mock('../../server/fn/receipts.ts', () => server);
vi.mock('../../server/fn/review.ts', () => ({ confirmReview: server.confirmReview }));
vi.mock('../../server/fn/ledger.ts', () => ({
  listAccounts: server.listAccounts,
  listCategories: server.listCategories,
  listTags: server.listTags,
  getReferenceRate: vi.fn(),
}));
vi.mock('../../server/fn/budget.ts', () => ({
  getBudgetStatus: server.getBudgetStatus,
}));
vi.mock('../../server/fn/transactions-write.ts', () => ({
  listTransactionDays: () => Promise.resolve({ ok: true, value: [] }),
  removeTransactions: server.removeTransactions,
}));
const saved = vi.hoisted(() => ({ announceSaved: vi.fn() }));
vi.mock('./announce-saved.tsx', () => saved);
const ready = (): ReceiptView => ({
  id: 'receipt-a',
  status: 'ready',
  name: 'apotek.png',
  errorCode: null,
  reviewItemId: 'review-a',
  transactionId: null,
  duplicates: [],
  extraction: {
    merchant: 'Apotek K-24',
    description: 'Obat',
    amountMinor: 96500n,
    currency: 'IDR',
    date: '2026-10-15' as LocalDate,
    time: '15:20',
    occurredAt: new Date('2026-10-15T08:20:00Z'),
    accountId: BCA.id,
    categoryId: categoryId('system:health'),
    uncertain: ['account'],
    items: [
      { name: 'Paracetamol 500mg', quantity: '2', amountMinor: 24000n, uncertain: false },
      { name: 'Vitamin C', quantity: '1', amountMinor: 45000n, uncertain: false },
      { name: 'Plester luka', quantity: '1', amountMinor: null, uncertain: true },
      { name: 'Minyak kayu putih', quantity: '1', amountMinor: 15000n, uncertain: false },
    ],
  },
  draft: {
    type: 'expense',
    occurredAt: new Date('2026-10-15T08:20:00Z'),
    accountId: BCA.id,
    amountMinor: 96500n,
    categoryId: categoryId('system:health'),
    description: 'Obat',
    source: 'receipt',
  },
});
const unreadable = (): ReceiptView => ({
  ...ready(),
  status: 'failed',
  extraction: null,
  draft: null,
  reviewItemId: null,
});
const reading = (): ReceiptView => ({ ...ready(), status: 'reading', extraction: null, draft: null });
const file = (type = 'image/png', size = 8) => new File([new Uint8Array(size)], 'apotek.png', { type });
const input = () => page.getByLabelText('Pilih atau seret satu struk').element() as HTMLInputElement;
const readButton = () => page.getByRole('button', { name: 'Baca struk', exact: true });
const cancelButton = () => page.getByRole('button', { name: 'Batal', exact: true }).first();
const attemptIds = () =>
  server.uploadReceipt.mock.calls.map((args) => {
    const request = args[0] as { data: FormData };
    return request.data.get('id');
  });
async function open() {
  const app = await renderApp(<ReceiptEntry timeZone="Asia/Jakarta" />);
  await readButton().click();
  return app;
}
function drop(target: Element | null, files: readonly File[]) {
  if (target === null) throw new Error('Missing drop target');
  const dataTransfer = new DataTransfer();
  for (const entry of files) dataTransfer.items.add(entry);
  target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
  target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
}
beforeEach(() => {
  vi.clearAllMocks();
  server.listAccounts.mockResolvedValue({ ok: true, value: { baseCurrency: 'IDR', accounts: [BCA] } });
  server.listCategories.mockResolvedValue({ ok: true, value: CATEGORIES });
  server.listTags.mockResolvedValue({ ok: true, value: TAGS });
  server.getBudgetStatus.mockResolvedValue({ ok: false, code: 'NOT_FOUND' });
  server.uploadReceipt.mockResolvedValue({ ok: true, value: ready() });
  server.getReceipt.mockResolvedValue({ ok: true, value: ready() });
  server.cancelReceipt.mockResolvedValue({ ok: true, value: undefined });
  server.confirmReview.mockResolvedValue({ ok: true, value: { transactionId: 'saved-a', overrideIds: [] } });
  server.prepareManualReceipt.mockResolvedValue({ ok: true, value: { reviewItemId: 'manual-a' } });
  server.removeTransactions.mockResolvedValue({ ok: true, value: { deleted: ['saved-a'] } });
});
describe('receipt draft interactions', () => {
  it('shows four items and uncertainty, allows correction and does not save until explicit confirmation', async () => {
    const { router } = await open();
    await userEvent.upload(input(), file());
    await expect.element(page.getByText('dari struk', { exact: true })).toBeVisible();
    await expect.element(page.getByText('Harga kurang jelas — periksa sebelum menyimpan')).toBeVisible();
    expect(server.confirmReview).not.toHaveBeenCalled();
    await page.getByRole('textbox', { name: 'Plester luka', exact: true }).fill('12500');
    await page.getByRole('textbox', { name: 'Catatan', exact: true }).fill('Obat dikoreksi');
    await page.getByRole('textbox', { name: 'Merchant', exact: true }).fill('Apotek K-24 dikoreksi');
    await page.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect.element(page.getByText('Struk terlampir')).toBeVisible();
    const request = server.confirmReview.mock.calls[0]?.[0] as {
      data: {
        itemId: string;
        edits: {
          description: string;
          merchant: string;
          receiptItems: { amountMinor: bigint | null; uncertain: boolean }[];
        };
      };
    };
    expect(request.data.itemId).toBe('review-a');
    expect(request.data.edits.description).toBe('Obat dikoreksi');
    expect(request.data.edits.merchant).toBe('Apotek K-24 dikoreksi');
    expect(request.data.edits.receiptItems[2]).toMatchObject({ amountMinor: 12500n, uncertain: false });
    expect(saved.announceSaved).toHaveBeenCalledTimes(1);
    await page.getByRole('button', { name: 'Buka di Transaksi' }).click();
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/transactions');
    expect(router.state.location.search).toEqual({ tx: 'saved-a' });
  });
  it('refreshes the next receipt impact from current balances after a save without resetting current edits', async () => {
    await open();
    await userEvent.upload(input(), file());
    await expect.element(page.getByText(/^Saldo BCA Tahapan jadi/)).toMatchTextContent('Rp42.713.500');
    await page.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect.element(page.getByText('Struk terlampir')).toBeVisible();
    server.listAccounts.mockResolvedValue({
      ok: true,
      value: { baseCurrency: 'IDR', accounts: [{ ...BCA, balanceMinor: 42713500n }] },
    });
    server.uploadReceipt.mockResolvedValue({ ok: true, value: { ...ready(), id: 'receipt-b' } });
    await userEvent.upload(input(), file());
    await expect.element(page.getByText(/^Saldo BCA Tahapan jadi/)).toMatchTextContent('Rp42.617.000');
    await page.getByRole('textbox', { name: 'Catatan', exact: true }).fill('Jangan reset');
    server.listAccounts.mockResolvedValue({ ok: true, value: { baseCurrency: 'IDR', accounts: [BCA] } });
    const notification = saved.announceSaved.mock.calls[0]?.[0] as { onChange: () => void };
    notification.onChange();
    await expect.element(page.getByText(/^Saldo BCA Tahapan jadi/)).toMatchTextContent('Rp42.713.500');
    await expect.element(page.getByRole('textbox', { name: 'Catatan', exact: true })).toHaveValue('Jangan reset');
  });
  it('polls a queued read once ready, then never overwrites newer manual edits', async () => {
    server.uploadReceipt.mockResolvedValue({
      ok: true,
      value: { ...ready(), status: 'queued', extraction: null, draft: null },
    });
    await open();
    await userEvent.upload(input(), file());
    await expect.element(page.getByText('dari struk', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Catatan', exact: true }).fill('Manual terbaru');
    await expect.element(page.getByRole('textbox', { name: 'Catatan', exact: true })).toHaveValue('Manual terbaru');
    expect(server.getReceipt).toHaveBeenCalledTimes(1);
    expect(server.confirmReview).not.toHaveBeenCalled();
  });
  it('offers explicit duplicate attach separately from record-new and never announces a ledger Undo for attachment-only', async () => {
    const view = ready();
    view.duplicates.push({
      id: 'existing-a',
      merchant: 'Indomaret',
      description: null,
      occurredAt: new Date('2026-10-15T00:55:00Z'),
      amountMinor: 110000n,
      accountId: BCA.id,
      categoryId: categoryId('system:food'),
    });
    view.duplicates.push({
      id: 'existing-b',
      merchant: null,
      description: 'Transfer ke Budi',
      occurredAt: new Date('2026-10-15T02:00:00Z'),
      amountMinor: 110000n,
      accountId: BCA.id,
      categoryId: null,
    });
    server.uploadReceipt.mockResolvedValue({ ok: true, value: view });
    await open();
    await userEvent.upload(input(), file());
    await expect.element(page.getByRole('button', { name: 'Konfirmasi catat baru' })).toBeVisible();
    expect(server.confirmReview).not.toHaveBeenCalled();
    await expect
      .element(page.getByRole('region', { name: 'Struk ini mungkin sudah tercatat' }))
      .toMatchTextContent(/Indomaret.*Transfer ke Budi.*Belum dikategorikan/);
    server.confirmReview.mockRejectedValueOnce(new Error('offline'));
    await page.getByRole('button', { name: 'Lampirkan ke transaksi ini' }).first().click();
    await expect.element(page.getByText('Transaksi tidak bisa disimpan. Coba lagi.')).toBeVisible();
    await page.getByRole('button', { name: 'Lampirkan ke transaksi ini' }).first().click();
    await expect.element(page.getByRole('status').getByText('Struk terlampir')).toBeVisible();
    expect(server.confirmReview).toHaveBeenCalledTimes(2);
    expect(server.confirmReview).toHaveBeenLastCalledWith({
      data: { itemId: 'review-a', edits: { receiptDuplicateId: 'existing-a' } },
    });
    expect(saved.announceSaved).not.toHaveBeenCalled();
    expect(page.getByRole('button', { name: 'Urungkan', exact: true }).query()).toBeNull();
  });
  it('keeps Undo reachable inside the success sheet and preserves the saved receipt when Undo is refused', async () => {
    await open();
    await userEvent.upload(input(), file());
    await page.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect.element(page.getByText('Struk terlampir')).toBeVisible();
    server.removeTransactions
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: false, code: 'PERIOD_CLOSED' });
    await page.getByRole('button', { name: 'Urungkan', exact: true }).click();
    await expect.element(page.getByText('Transaksi tidak bisa disimpan. Coba lagi.')).toBeVisible();
    expect(page.getByRole('button', { name: 'Coba lagi', exact: true }).query()).toBeNull();
    await page.getByRole('button', { name: 'Urungkan', exact: true }).click();
    await expect.element(page.getByText('Periode ini sudah ditutup dan hanya bisa dibaca.')).toBeVisible();
    await expect.element(page.getByRole('button', { name: 'Buka di Transaksi' })).toBeVisible();
    await page.getByRole('button', { name: 'Urungkan', exact: true }).click();
    await expect.element(page.getByRole('button', { name: 'Buka di Transaksi' })).not.toBeInTheDocument();
    expect(server.removeTransactions).toHaveBeenCalledWith({ data: { ids: ['saved-a'] } });
    expect(server.removeTransactions).toHaveBeenCalledTimes(3);
  });
  it('keeps an existing editable receipt when a replacement upload fails', async () => {
    await open();
    await userEvent.upload(input(), file());
    await expect.element(page.getByText('dari struk', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Catatan', exact: true }).fill('Jangan ganti');
    server.uploadReceipt.mockResolvedValueOnce({ ok: false, code: 'IMAGE_REJECTED' });
    await userEvent.upload(input(), file());
    await expect.element(page.getByRole('textbox', { name: 'Catatan', exact: true })).toHaveValue('Jangan ganti');
    expect(server.confirmReview).not.toHaveBeenCalled();
  });
  it('cancels without saving and offers manual entry for unreadable receipts', async () => {
    server.uploadReceipt.mockResolvedValue({
      ok: true,
      value: unreadable(),
    });
    await open();
    await userEvent.upload(input(), file());
    const picker = vi.fn((event: Event) => {
      event.preventDefault();
    });
    input().addEventListener('click', picker);
    // The file input is a button with the same name; the failed read's own button comes after it.
    await page.getByRole('button', { name: 'Pilih atau seret satu struk', exact: true }).last().click();
    expect(picker).toHaveBeenCalledTimes(1);
    await page.getByRole('button', { name: 'Isi manual', exact: true }).click();
    await expect.element(page.getByRole('textbox', { name: 'Jumlah', exact: true })).toHaveValue('');
    expect(server.confirmReview).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Batal', exact: true }).first().click();
    expect(server.cancelReceipt).toHaveBeenCalledTimes(1);
    expect(server.confirmReview).not.toHaveBeenCalled();
  });
  it('retries an unreadable receipt only on click with a fresh attempt ID, then recovers without auto-saving', async () => {
    server.uploadReceipt.mockResolvedValueOnce({
      ok: true,
      value: unreadable(),
    });
    await open();
    await userEvent.upload(input(), file());
    await expect.element(page.getByRole('button', { name: 'Coba lagi', exact: true })).toBeVisible();
    expect(server.uploadReceipt).toHaveBeenCalledTimes(1);
    await page.getByRole('button', { name: 'Coba lagi', exact: true }).click();
    await expect.element(page.getByText('dari struk', { exact: true })).toBeVisible();
    const attempts = server.uploadReceipt.mock.calls.map((args) => {
      const request = args[0] as { data: FormData };
      return request.data.get('id');
    });
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).not.toBe(attempts[1]);
    expect(server.confirmReview).not.toHaveBeenCalled();
  });
  it('saves manually entered details only after the user confirms, retaining the failed receipt', async () => {
    server.uploadReceipt.mockResolvedValue({
      ok: true,
      value: unreadable(),
    });
    await open();
    await userEvent.upload(input(), file());
    await page.getByRole('button', { name: 'Isi manual', exact: true }).click();
    await page.getByRole('textbox', { name: 'Jumlah', exact: true }).fill('42000');
    await page.getByRole('button', { name: 'Makan & Dapur', exact: true }).click();
    await page.getByRole('textbox', { name: 'Catatan', exact: true }).fill('Manual');
    expect(server.prepareManualReceipt).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect.element(page.getByText('Struk terlampir')).toBeVisible();
    expect(server.prepareManualReceipt).toHaveBeenCalledTimes(1);
    expect(server.confirmReview.mock.calls[0]?.[0]).toMatchObject({
      data: { itemId: 'manual-a', edits: { amountMinor: 42000n, description: 'Manual' } },
    });
  });
  it('rejects WebP and oversized files before enqueue, and clears the file input for another choice', async () => {
    await open();
    await userEvent.upload(input(), file('image/webp'));
    await expect.element(page.getByText(/HEIC dan WebP tidak didukung/)).toBeVisible();
    await userEvent.upload(input(), file('image/png', 2097153));
    expect(server.uploadReceipt).not.toHaveBeenCalled();
    expect(input().value).toBe('');
  });
  it('retries a failed upload under the same attempt ID so a lost reply cannot stage the receipt twice', async () => {
    server.uploadReceipt
      .mockResolvedValueOnce({ ok: false, code: 'AI_PERMISSION_REQUIRED' })
      .mockRejectedValueOnce(new Error('offline'));
    await open();
    await userEvent.upload(input(), file());
    await expect.element(page.getByText('Agen tidak punya izin yang dibutuhkan permintaan ini.')).toBeVisible();
    await page.getByRole('button', { name: 'Coba lagi', exact: true }).click();
    await expect.element(page.getByText(/^Struk tidak bisa dibaca/)).toBeVisible();
    await page.getByRole('button', { name: 'Coba lagi', exact: true }).click();
    await expect.element(page.getByText('dari struk', { exact: true })).toBeVisible();
    await userEvent.upload(input(), file());
    await expect.poll(() => server.uploadReceipt.mock.calls.length).toBe(4);
    const [first, second, third, fresh] = attemptIds();
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(fresh).not.toBe(first);
    expect(server.confirmReview).not.toHaveBeenCalled();
  });
  it('accepts exactly one dropped receipt and ignores another drop while one is being read', async () => {
    server.uploadReceipt.mockResolvedValue({ ok: true, value: reading() });
    server.getReceipt.mockReturnValue(Promise.withResolvers().promise);
    await renderApp(<ReceiptEntry timeZone="Asia/Jakarta" />);
    drop(readButton().element().parentElement, [file(), file()]);
    await expect.element(page.getByText(/HEIC dan WebP tidak didukung/)).toBeVisible();
    drop(input().parentElement, [file('application/pdf')]);
    await expect.element(page.getByText('Membaca nominal, tanggal dan merchant…')).toBeVisible();
    drop(input().parentElement, [file()]);
    expect(server.uploadReceipt).toHaveBeenCalledTimes(1);
    const request = server.uploadReceipt.mock.calls[0]?.[0] as { data: FormData };
    expect((request.data.get('file') as File).type).toBe('application/pdf');
  });
  it('keeps polling through a lost reply and an unfinished read, without saving', async () => {
    server.uploadReceipt.mockResolvedValue({ ok: true, value: { ...reading(), status: 'queued' } });
    server.getReceipt.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true, value: reading() });
    await open();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      await userEvent.upload(input(), file());
      await expect.poll(() => server.getReceipt.mock.calls.length).toBe(1);
      await vi.advanceTimersByTimeAsync(1500);
      await expect.poll(() => server.getReceipt.mock.calls.length).toBe(2);
      await flushReact();
      await expect.element(page.getByText('Membaca nominal, tanggal dan merchant…')).toBeVisible();
      await vi.advanceTimersByTimeAsync(1500);
      await flushReact();
      await expect.element(page.getByText('dari struk', { exact: true })).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
    expect(server.getReceipt).toHaveBeenCalledTimes(3);
    expect(server.confirmReview).not.toHaveBeenCalled();
  });
  it('keeps a reading receipt when cancelling is refused, and drops poll replies that arrive after cancelling', async () => {
    server.uploadReceipt.mockResolvedValue({ ok: true, value: reading() });
    const racing = Promise.withResolvers<unknown>();
    server.getReceipt.mockReturnValueOnce(racing.promise);
    server.cancelReceipt.mockRejectedValueOnce(new Error('offline'));
    await open();
    await userEvent.upload(input(), file());
    await cancelButton().click();
    await expect.element(page.getByText(/^Struk tidak bisa dibaca/)).toBeVisible();
    await expect.element(page.getByText('Membaca nominal, tanggal dan merchant…')).toBeVisible();
    const cancelled = Promise.withResolvers<unknown>();
    server.cancelReceipt.mockReturnValueOnce(cancelled.promise);
    await cancelButton().click();
    // Both replies land before React renders the cancellation.
    cancelled.resolve({ ok: true, value: undefined });
    racing.resolve({ ok: true, value: ready() });
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await readButton().click();
    await expect.element(page.getByText('apotek.png')).not.toBeInTheDocument();

    const late = Promise.withResolvers<unknown>();
    server.uploadReceipt.mockResolvedValueOnce({ ok: true, value: { ...reading(), id: 'receipt-b' } });
    server.getReceipt.mockReturnValueOnce(late.promise);
    await userEvent.upload(input(), file());
    await expect.element(page.getByText('Membaca nominal, tanggal dan merchant…')).toBeVisible();
    await cancelButton().click();
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    late.resolve({ ok: true, value: { ...ready(), id: 'receipt-b' } });
    await flushReact();
    await readButton().click();
    await expect.element(page.getByText('apotek.png')).not.toBeInTheDocument();
    expect(server.cancelReceipt).toHaveBeenCalledTimes(3);
    expect(server.confirmReview).not.toHaveBeenCalled();
  });
  it('reports ledger data that cannot load and recovers on the next load', async () => {
    server.listAccounts.mockRejectedValueOnce(new Error('offline'));
    await open();
    const failed = page.getByText('Kategori & rekening tidak bisa dimuat. Coba lagi.');
    await expect.element(failed).toBeVisible();
    await userEvent.keyboard('{Escape}');
    server.listTags.mockResolvedValueOnce({ ok: false, code: 'UNAUTHENTICATED' });
    await readButton().click();
    await expect.poll(() => server.listTags.mock.calls.length).toBe(2);
    await expect.element(failed).toBeVisible();
    await userEvent.upload(input(), file());
    await expect.element(page.getByRole('button', { name: 'Simpan', exact: true })).toBeVisible();
    await expect.element(failed).not.toBeInTheDocument();
  });
  it('ignores ledger data replies superseded by a newer load', async () => {
    const closed = Promise.withResolvers<unknown>();
    const replaced = Promise.withResolvers<unknown>();
    server.listAccounts.mockReturnValueOnce(closed.promise).mockReturnValueOnce(replaced.promise);
    await open();
    await userEvent.keyboard('{Escape}');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
    await readButton().click();
    await userEvent.upload(input(), file());
    await expect.element(page.getByRole('button', { name: 'Simpan', exact: true })).toBeVisible();
    closed.resolve({ ok: false, code: 'UNAUTHENTICATED' });
    replaced.reject(new Error('offline'));
    await flushReact();
    expect(page.getByText('Kategori & rekening tidak bisa dimuat. Coba lagi.').query()).toBeNull();
    await expect.element(page.getByRole('button', { name: 'Simpan', exact: true })).toBeVisible();
  });
  it('shows the budget impact of a read receipt, and still reads receipts when the budget cannot load', async () => {
    const read = ready();
    if (read.draft?.type !== 'expense') throw new Error('Missing expense draft');
    const view = { ...read, draft: { ...read.draft, categoryId: categoryId('system:food') } };
    server.uploadReceipt.mockResolvedValue({ ok: true, value: view });
    server.getBudgetStatus.mockResolvedValue({ ok: true, value: budgetStatus({ lines: [...RECORD_BUDGET.lines] }) });
    const first = await open();
    await userEvent.upload(input(), file());
    await expect.element(page.getByText(/^Anggaran Makan & Dapur jadi/)).toBeVisible();
    await first.screen.unmount();

    server.getBudgetStatus.mockRejectedValue(new Error('offline'));
    await open();
    await userEvent.upload(input(), file());
    await expect.element(page.getByRole('button', { name: 'Simpan', exact: true })).toBeVisible();
    expect(page.getByText(/^Anggaran /).query()).toBeNull();
  });
  it('saves a manual receipt once per request and recovers from lost replies', async () => {
    server.uploadReceipt.mockResolvedValue({ ok: true, value: unreadable() });
    await open();
    await userEvent.upload(input(), file());
    await page.getByRole('button', { name: 'Isi manual', exact: true }).click();
    await page.getByRole('button', { name: 'Simpan', exact: true }).click();
    expect(server.prepareManualReceipt).not.toHaveBeenCalled();
    await page.getByRole('textbox', { name: 'Jumlah', exact: true }).fill('42000');
    await page.getByRole('button', { name: 'Makan & Dapur', exact: true }).click();
    server.prepareManualReceipt.mockRejectedValueOnce(new Error('offline'));
    await page.getByRole('button', { name: 'Simpan', exact: true }).click();
    const failed = page.getByText('Transaksi tidak bisa disimpan. Coba lagi.');
    await expect.element(failed).toBeVisible();
    expect(server.confirmReview).not.toHaveBeenCalled();
    server.confirmReview.mockRejectedValueOnce(new Error('offline'));
    await page.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect.poll(() => server.confirmReview.mock.calls.length).toBe(1);
    await expect.element(failed).toBeVisible();
    const confirmation = Promise.withResolvers<unknown>();
    server.confirmReview.mockReturnValueOnce(confirmation.promise);
    await page.getByRole('textbox', { name: 'Catatan', exact: true }).click();
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await expect.element(page.getByRole('button', { name: 'Simpan', exact: true })).toBeDisabled();
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(server.confirmReview).toHaveBeenCalledTimes(2);
    expect(server.prepareManualReceipt).toHaveBeenCalledTimes(3);
    expect(server.prepareManualReceipt.mock.calls[2]?.[0]).toMatchObject({
      data: { id: 'receipt-a', amountMinor: 42000n, description: '', note: '', tags: [] },
    });
    confirmation.resolve({ ok: true, value: { transactionId: 'saved-a', overrideIds: [] } });
    await expect.element(page.getByText('Struk terlampir')).toBeVisible();
    expect(saved.announceSaved.mock.calls[0]?.[0]).toMatchObject({ label: 'apotek.png', amountMinor: -42000n });
  });
  it('keeps corrections when the period is closed and resets once the saved receipt is undone from its toast', async () => {
    const read = ready();
    if (read.extraction === null || read.draft?.type !== 'expense') throw new Error('Missing extraction');
    const view: ReceiptView = {
      ...read,
      extraction: { ...read.extraction, uncertain: [], items: [] },
      draft: { ...read.draft, description: null },
    };
    server.uploadReceipt.mockResolvedValue({ ok: true, value: view });
    server.confirmReview.mockResolvedValueOnce({ ok: false, code: 'PERIOD_CLOSED' });
    await open();
    await userEvent.upload(input(), file());
    await expect.element(page.getByText('dari struk', { exact: true })).toBeVisible();
    expect(page.getByText(/^Periksa isian/).query()).toBeNull();
    expect(page.getByRole('region', { name: 'Item struk' }).query()).toBeNull();
    await page.getByRole('textbox', { name: 'Merchant', exact: true }).fill('Apotek Baru');
    await page.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect.element(page.getByText('Periode ini sudah ditutup dan hanya bisa dibaca.')).toBeVisible();
    await expect.element(page.getByRole('textbox', { name: 'Merchant', exact: true })).toHaveValue('Apotek Baru');
    expect(saved.announceSaved).not.toHaveBeenCalled();
    await page.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect.element(page.getByText('Struk terlampir')).toBeVisible();
    const notification = saved.announceSaved.mock.calls[0]?.[0] as { label: string; onChange: () => void };
    expect(notification.label).toBe('apotek.png');
    notification.onChange();
    await expect.element(page.getByText('Struk terlampir')).not.toBeInTheDocument();
    await expect.element(page.getByText('apotek.png')).not.toBeInTheDocument();
  });
  it('never records a receipt to an account in another currency or without an account', async () => {
    const read = ready();
    if (read.extraction === null) throw new Error('Missing extraction');
    const foreign: ReceiptView = {
      ...read,
      draft: null,
      extraction: {
        ...read.extraction,
        currency: 'USD',
        accountId: null,
        items: [{ name: 'Coffee', quantity: '1', amountMinor: 1250n, uncertain: false }],
      },
    };
    server.uploadReceipt.mockResolvedValueOnce({ ok: true, value: foreign });
    await open();
    await userEvent.upload(input(), file());
    await expect.element(page.getByRole('textbox', { name: 'Coffee', exact: true })).toHaveValue('12,50');
    await page.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect.element(page.getByText('Pilih rekening').first()).toBeVisible();
    await page.getByRole('button', { name: 'Batal', exact: true }).first().click();
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();

    server.listAccounts.mockResolvedValue({ ok: true, value: { baseCurrency: 'IDR', accounts: [] } });
    server.uploadReceipt.mockResolvedValueOnce({ ok: true, value: unreadable() });
    await readButton().click();
    await userEvent.upload(input(), file());
    await page.getByRole('button', { name: 'Isi manual', exact: true }).click();
    await page.getByRole('textbox', { name: 'Jumlah', exact: true }).fill('42000');
    await page.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect.element(page.getByText('Pilih rekening').first()).toBeVisible();
    expect(server.prepareManualReceipt).not.toHaveBeenCalled();
    expect(server.confirmReview).not.toHaveBeenCalled();
  });
});
