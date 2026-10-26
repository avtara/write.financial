// SPDX-License-Identifier: AGPL-3.0-only
import type { ReceiptView } from '@wf/db/receipts';
import type { LocalDate } from '@wf/domain/period';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { BCA, CATEGORIES, TAGS, categoryId } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { ReceiptEntry } from './receipt-entry.tsx';
const server = vi.hoisted(() => ({
  uploadReceipt: vi.fn(),
  getReceipt: vi.fn(),
  cancelReceipt: vi.fn(),
  prepareManualReceipt: vi.fn(),
  confirmReview: vi.fn(),
  listAccounts: vi.fn(),
  removeTransactions: vi.fn(),
}));
vi.mock('../../server/fn/receipts.ts', () => server);
vi.mock('../../server/fn/review.ts', () => ({ confirmReview: server.confirmReview }));
vi.mock('../../server/fn/ledger.ts', () => ({
  listAccounts: server.listAccounts,
  listCategories: () => Promise.resolve({ ok: true, value: CATEGORIES }),
  listTags: () => Promise.resolve({ ok: true, value: TAGS }),
  getReferenceRate: vi.fn(),
}));
vi.mock('../../server/fn/budget.ts', () => ({
  getBudgetStatus: () => Promise.resolve({ ok: false, code: 'NOT_FOUND' }),
}));
vi.mock('../../server/fn/transactions-write.ts', () => ({
  listTransactionDays: () => Promise.resolve({ ok: true, value: [] }),
  removeTransactions: server.removeTransactions,
}));
const saved = vi.hoisted(() => ({ announceSaved: vi.fn() }));
vi.mock('./record-transaction.tsx', () => saved);
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
const file = (type = 'image/png', size = 8) => new File([new Uint8Array(size)], 'apotek.png', { type });
const input = () => page.getByLabelText('Pilih atau seret satu struk').element() as HTMLInputElement;
async function open() {
  await renderApp(<ReceiptEntry timeZone="Asia/Jakarta" />);
  await page.getByRole('button', { name: 'Baca struk', exact: true }).click();
}
beforeEach(() => {
  vi.clearAllMocks();
  server.listAccounts.mockResolvedValue({ ok: true, value: { baseCurrency: 'IDR', accounts: [BCA] } });
  server.uploadReceipt.mockResolvedValue({ ok: true, value: ready() });
  server.getReceipt.mockResolvedValue({ ok: true, value: ready() });
  server.cancelReceipt.mockResolvedValue({ ok: true, value: undefined });
  server.confirmReview.mockResolvedValue({ ok: true, value: { transactionId: 'saved-a', overrideIds: [] } });
  server.prepareManualReceipt.mockResolvedValue({ ok: true, value: { reviewItemId: 'manual-a' } });
  server.removeTransactions.mockResolvedValue({ ok: true, value: { deleted: ['saved-a'] } });
});
describe('receipt draft interactions', () => {
  it('shows four items and uncertainty, allows correction and does not save until explicit confirmation', async () => {
    await open();
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
    await expect.element(page.getByRole('button', { name: 'Buka di Transaksi' })).toBeVisible();
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
    server.uploadReceipt.mockResolvedValue({ ok: true, value: view });
    await open();
    await userEvent.upload(input(), file());
    await expect.element(page.getByRole('button', { name: 'Konfirmasi catat baru' })).toBeVisible();
    expect(server.confirmReview).not.toHaveBeenCalled();
    await expect
      .element(page.getByRole('region', { name: 'Struk ini mungkin sudah tercatat' }))
      .toMatchTextContent('Indomaret');
    await page.getByRole('button', { name: 'Lampirkan ke transaksi ini' }).click();
    expect(server.confirmReview).toHaveBeenCalledWith({
      data: { itemId: 'review-a', edits: { receiptDuplicateId: 'existing-a' } },
    });
    expect(saved.announceSaved).not.toHaveBeenCalled();
  });
  it('keeps Undo reachable inside the success sheet and preserves the saved receipt when Undo is refused', async () => {
    await open();
    await userEvent.upload(input(), file());
    await page.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect.element(page.getByText('Struk terlampir')).toBeVisible();
    server.removeTransactions.mockResolvedValueOnce({ ok: false, code: 'PERIOD_CLOSED' });
    await page.getByRole('button', { name: 'Urungkan', exact: true }).click();
    await expect.element(page.getByRole('button', { name: 'Buka di Transaksi' })).toBeVisible();
    await page.getByRole('button', { name: 'Urungkan', exact: true }).click();
    await expect.element(page.getByRole('button', { name: 'Buka di Transaksi' })).not.toBeInTheDocument();
    expect(server.removeTransactions).toHaveBeenCalledWith({ data: { ids: ['saved-a'] } });
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
      value: { ...ready(), status: 'failed', extraction: null, draft: null, reviewItemId: null },
    });
    await open();
    await userEvent.upload(input(), file());
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
      value: { ...ready(), status: 'failed', extraction: null, draft: null, reviewItemId: null },
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
      value: { ...ready(), status: 'failed', extraction: null, draft: null, reviewItemId: null },
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
});
