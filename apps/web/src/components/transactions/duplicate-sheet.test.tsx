// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { BCA, categoryId, LEDGER } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { RECEIPT, transactionDetail } from '../../../test/transaction-fixtures.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { DuplicateSheet } from './duplicate-sheet.tsx';

const server = vi.hoisted(() => ({ duplicateTransaction: vi.fn() }));
vi.mock('../../server/fn/transactions.ts', () => server);
vi.mock('../../server/fn/ledger.ts', () => ({ getReferenceRate: vi.fn() }));
vi.mock('../../server/fn/transactions-write.ts', () => ({
  listTransactionDays: vi.fn().mockResolvedValue({ ok: true, value: [] }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

async function renderSheet(detail = transactionDetail('tx-1')) {
  const onClose = vi.fn();
  const onSaved = vi.fn(() => Promise.resolve());
  await renderApp(
    <DuplicateSheet detail={detail} ledger={LEDGER} timeZone="Asia/Jakarta" onClose={onClose} onSaved={onSaved} />,
  );
  return { onClose, onSaved, sheet: page.getByRole('dialog', { name: 'Duplikat transaksi' }) };
}

describe('DuplicateSheet', () => {
  it('fills the form from the original, dated now, and saves a copy keeping the merchant', async () => {
    server.duplicateTransaction.mockResolvedValue({ ok: true, value: { id: 'tx-copy' } });
    const { sheet, onSaved } = await renderSheet(
      transactionDetail('tx-1', { merchant: 'Shopee', description: 'Kabel data', attachments: [RECEIPT] }),
    );
    await expect
      .element(sheet)
      .toHaveAccessibleDescription('Disalin dari Shopee · 15 Okt. Ubah yang perlu, lalu simpan.');
    await expect.element(sheet.getByText('Struk & gambar tidak ikut disalin')).toBeVisible();
    await expect.element(sheet.getByRole('textbox', { name: 'Jumlah' })).toHaveValue('10.000');
    await userEvent.click(sheet.getByRole('button', { name: 'Simpan' }));
    expect(server.duplicateTransaction).toHaveBeenCalledWith({
      data: {
        id: 'tx-1',
        input: expect.objectContaining({
          type: 'expense',
          amountMinor: 10_000n,
          accountId: BCA.id,
          categoryId: categoryId('system:food'),
          description: 'Kabel data',
          merchant: 'Shopee',
        }) as unknown,
      },
    });
    expect(onSaved).toHaveBeenCalledWith('tx-copy');
  });

  it('shows why a copy was refused, and closes', async () => {
    server.duplicateTransaction.mockResolvedValue({ ok: false, code: 'PERIOD_CLOSED' });
    const { sheet, onSaved, onClose } = await renderSheet();
    await expect.element(sheet.getByText('Struk & gambar tidak ikut disalin')).not.toBeInTheDocument();
    await userEvent.click(sheet.getByRole('button', { name: 'Simpan' }));
    expect(server.duplicateTransaction).toHaveBeenCalledWith({
      data: { id: 'tx-1', input: expect.not.objectContaining({ merchant: expect.anything() as unknown }) as unknown },
    });
    await expect.element(sheet.getByText(ledgerErrorMessage('PERIOD_CLOSED', 'id'))).toBeVisible();
    expect(onSaved).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
