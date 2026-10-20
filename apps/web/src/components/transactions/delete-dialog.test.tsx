// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { BCA, GOTRADE, LEDGER, OVO, userCategory } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { transactionRow } from '../../../test/transaction-fixtures.ts';
import type { ActionRow } from './action-row.ts';
import { balanceChanges, DeleteDialog } from './delete-dialog.tsx';

const KOPI = userCategory({ id: 'c-kopi', name: 'Kopi' });
const ledger = { ...LEDGER, categories: [...LEDGER.categories, KOPI] };
/** Rp500.000 from BCA Tahapan to OVO with a Rp2.500 fee. */
const TRANSFER = transactionRow('tx-transfer', {
  type: 'transfer',
  categoryId: null,
  amountMinor: -500_000n,
  toAccountId: OVO.id,
  receivedMinor: 500_000n,
  feeMinor: 2_500n,
});

async function renderDialog(rows: readonly ActionRow[], onConfirm = vi.fn(() => Promise.resolve())) {
  const onCancel = vi.fn();
  await renderApp(
    <DeleteDialog rows={rows} ledger={ledger} timeZone="Asia/Jakarta" onCancel={onCancel} onConfirm={onConfirm} />,
  );
  return { onCancel, onConfirm };
}

describe('balanceChanges', () => {
  it('gives back what each row took, a transfer’s fee to its source, and takes back what it delivered', () => {
    const expense = transactionRow('a', { amountMinor: -389_000n });
    const income = transactionRow('b', { type: 'income', amountMinor: 100_000n, accountId: OVO.id });
    // A transfer whose destination amount is unknown leaves the destination alone.
    const partial = transactionRow('c', { type: 'transfer', toAccountId: GOTRADE.id, amountMinor: -1_000n });
    expect([...balanceChanges([expense, income, TRANSFER, partial])]).toEqual([
      [BCA.id, 389_000n + 502_500n + 1_000n],
      [OVO.id, -100_000n - 500_000n],
    ]);
    expect(balanceChanges([])).toEqual(new Map());
  });
});

describe('DeleteDialog', () => {
  it('asks to delete one transaction, showing it and the balance before → after', async () => {
    const row = transactionRow('tx-1', { categoryId: KOPI.id, merchant: 'Kopi Kenangan', amountMinor: -389_000n });
    const { onCancel, onConfirm } = await renderDialog([row]);
    const dialog = page.getByRole('dialog', { name: 'Hapus transaksi ini?' });
    await expect
      .element(dialog)
      .toHaveAccessibleDescription('Kamu masih bisa mengurungkannya beberapa detik setelah dihapus.');
    await expect.element(dialog.getByText('Kopi', { exact: true })).toBeVisible();
    await expect.element(dialog.getByText(/12[.:]41/)).toBeVisible();
    await expect.element(dialog.getByText('−Rp389.000')).toBeVisible();
    const balance = dialog.getByRole('listitem');
    await expect.element(balance).toMatchTextContent('Saldo BCA Tahapan');
    await expect.element(balance).toMatchTextContent('Rp42.810.000→menjadiRp43.199.000');
    await userEvent.click(dialog.getByRole('button', { name: 'Batal' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('names a transfer by its label and shows both accounts', async () => {
    await renderDialog([TRANSFER]);
    const dialog = page.getByRole('dialog', { name: 'Hapus transaksi ini?' });
    await expect.element(dialog.getByText('Transfer', { exact: true })).toBeVisible();
    await expect.poll(() => dialog.getByRole('listitem').all()).toHaveLength(2);
    await expect.element(dialog.getByRole('listitem').nth(0)).toMatchTextContent('Rp42.810.000→menjadiRp43.312.500');
    await expect.element(dialog.getByRole('listitem').nth(1)).toMatchTextContent('Saldo OVO');
    await expect.element(dialog.getByRole('listitem').nth(1)).toMatchTextContent('Rp86.000→menjadi−Rp414.000');
  });

  it('deletes many, noting attachments, skipping unknown accounts and unchanged balances, and waits', async () => {
    const confirm = Promise.withResolvers<undefined>();
    const rows = [
      transactionRow('a', { amountMinor: -10_000n, hasAttachment: true }),
      transactionRow('b', { type: 'income', amountMinor: 10_000n }),
      transactionRow('c', { accountId: 'acc-gone' }),
    ];
    const { onCancel, onConfirm } = await renderDialog(
      rows,
      vi.fn(() => confirm.promise),
    );
    const dialog = page.getByRole('dialog', { name: 'Hapus 3 transaksi?' });
    await expect
      .element(dialog)
      .toHaveAccessibleDescription(
        'Struk dan gambar ikut terhapus. Kamu masih bisa mengurungkannya beberapa detik setelah dihapus.',
      );
    await expect.element(dialog.getByRole('listitem')).not.toBeInTheDocument();
    const remove = dialog.getByRole('button', { name: 'Hapus' });
    await userEvent.click(remove);
    expect(onConfirm).toHaveBeenCalledOnce();
    await expect.element(remove).toHaveAttribute('aria-busy', 'true');
    await expect.element(dialog.getByRole('button', { name: 'Batal' })).toBeDisabled();
    // Escape does not close it while deleting.
    await userEvent.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
    confirm.resolve(undefined);
    await expect.element(remove).toHaveAttribute('aria-busy', 'false');
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
