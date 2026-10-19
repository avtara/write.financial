// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { accountView, CATEGORIES } from '../../../test/accounts.ts';
import { renderApp } from '../../../test/render.tsx';
import { BulkReconcileDialog } from './bulk-reconcile.tsx';

const server = vi.hoisted(() => ({ reconcileAccounts: vi.fn(), toast: vi.fn() }));
vi.mock('../../server/fn/accounts.ts', () => ({ reconcileAccounts: server.reconcileAccounts }));
vi.mock('@wf/ui/toast', () => ({ toast: server.toast }));

const OVO = accountView({
  displayName: 'OVO',
  type: 'ewallet',
  balanceMinor: 86_000n,
  lastReconciledAt: new Date('2026-09-01T05:00:00Z'),
});
const CASH = accountView({ displayName: 'Dompet', type: 'cash', balanceMinor: 350_000n, lastReconciledAt: new Date() });
const GOTRADE = accountView({
  displayName: 'Gotrade',
  currency: 'USD',
  balanceMinor: 277_800n,
  lastReconciledAt: new Date(),
});

async function renderBulk(categories = CATEGORIES) {
  const onOpenChange = vi.fn();
  const onDone = vi.fn();
  await renderApp(
    <BulkReconcileDialog
      accounts={[CASH, OVO, GOTRADE]}
      categories={categories}
      baseCurrency="IDR"
      timeZone="Asia/Jakarta"
      onOpenChange={onOpenChange}
      onDone={onDone}
    />,
  );
  return { dialog: page.getByRole('dialog'), onOpenChange, onDone };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('BulkReconcileDialog', () => {
  it('lists the longest unchecked first and records the filled rows', async () => {
    server.reconcileAccounts.mockResolvedValue({ ok: true, value: [] });
    const { dialog, onDone } = await renderBulk();
    await expect.element(dialog).toHaveAccessibleName('Sesuaikan beberapa rekening');
    const names = dialog
      .getByRole('listitem')
      .elements()
      .map((row) => row.textContent);
    expect(names[0]).toContain('OVO');
    await expect.element(dialog.getByText(/dicek \d+ hari lalu/).first()).toHaveClass(/text-amber-fg/);
    await expect.element(dialog.getByRole('button', { name: 'Sesuaikan' })).toBeDisabled();

    await userEvent.fill(dialog.getByRole('textbox', { name: 'Saldo sebenarnya OVO' }), '71.500');
    await userEvent.fill(dialog.getByRole('textbox', { name: 'Saldo sebenarnya Dompet' }), '312.000');
    await userEvent.fill(dialog.getByRole('textbox', { name: 'Saldo sebenarnya Gotrade' }), '2.778,00');
    await expect.element(dialog).toHaveAccessibleName('Sesuaikan 3 rekening');
    await expect
      .element(dialog.getByRole('combobox', { name: 'Kategori selisih OVO' }))
      .toHaveTextContent('Admin bulanan');
    await userEvent.click(dialog.getByRole('combobox', { name: 'Kategori selisih Dompet' }));
    await userEvent.click(page.getByRole('option', { name: 'Makan & Dapur' }));
    expect(dialog.element().textContent).toContain('total −Rp52.500');
    await userEvent.click(dialog.getByRole('button', { name: 'Sesuaikan' }));
    expect(server.reconcileAccounts).toHaveBeenCalledWith({
      data: {
        occurredAt: expect.any(Date) as unknown,
        items: [
          {
            id: OVO.id,
            actualBalanceMinor: 71_500n,
            categoryId: CATEGORIES[0]?.id,
            clientId: expect.any(String) as unknown,
          },
          {
            id: CASH.id,
            actualBalanceMinor: 312_000n,
            categoryId: CATEGORIES[1]?.id,
            clientId: expect.any(String) as unknown,
          },
          { id: GOTRADE.id, actualBalanceMinor: 277_800n, categoryId: null, clientId: expect.any(String) as unknown },
        ],
      },
    });
    expect(server.toast).toHaveBeenCalledWith({ title: '3 rekening disesuaikan' });
    expect(onDone).toHaveBeenCalled();
  });

  it('leaves a shortfall uncategorized when there is no monthly-fee category', async () => {
    const { dialog } = await renderBulk(CATEGORIES.slice(1));
    await userEvent.fill(dialog.getByRole('textbox', { name: 'Saldo sebenarnya OVO' }), '71.500');
    await expect
      .element(dialog.getByRole('combobox', { name: 'Kategori selisih OVO' }))
      .toHaveTextContent('Tanpa kategori');
  });

  it('books a surplus without a default category, shows refusals, and cancels', async () => {
    server.reconcileAccounts.mockResolvedValue({ ok: false, code: 'CATEGORY_KIND_MISMATCH' });
    const { dialog, onDone, onOpenChange } = await renderBulk();
    await userEvent.fill(dialog.getByRole('textbox', { name: 'Saldo sebenarnya OVO' }), '100.000');
    await expect
      .element(dialog.getByRole('combobox', { name: 'Kategori selisih OVO' }))
      .toHaveTextContent('Tanpa kategori');
    await userEvent.click(dialog.getByRole('button', { name: 'Sesuaikan' }));
    await expect.element(dialog.getByText('Kategori ini tidak cocok dengan jenis transaksinya.')).toBeVisible();
    expect(onDone).not.toHaveBeenCalled();
    await userEvent.click(dialog.getByRole('button', { name: 'Batal' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
