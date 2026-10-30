// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { accountView } from '../../../test/accounts.ts';
import { renderApp } from '../../../test/render.tsx';
import { ArchiveDialog } from './archive-dialog.tsx';

const server = vi.hoisted(() => ({ archiveAccount: vi.fn(), toast: vi.fn() }));
vi.mock('../../server/fn/accounts.ts', () => ({ archiveAccount: server.archiveAccount }));
vi.mock('@wf/ui/toast', () => ({ toast: server.toast }));

const BCA = accountView({ displayName: 'BCA Tahapan', balanceMinor: 42_810_000n, transactionCount: 214 });
const JAGO = accountView({ displayName: 'Bank Jago', balanceMinor: 8_125_000n });
const MANDIRI = accountView({ displayName: 'Mandiri', balanceMinor: 3_240_000n });
const GOTRADE = accountView({ displayName: 'Gotrade', currency: 'USD' });
const OLD = accountView({ displayName: 'Jenius', status: 'archived' });

async function renderArchive(account = BCA, accounts = [BCA, JAGO, MANDIRI, GOTRADE, OLD]) {
  const onOpenChange = vi.fn();
  const onDone = vi.fn();
  await renderApp(<ArchiveDialog account={account} accounts={accounts} onOpenChange={onOpenChange} onDone={onDone} />);
  return { dialog: page.getByRole('dialog', { name: `Arsipkan ${account.displayName}?` }), onOpenChange, onDone };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('ArchiveDialog', () => {
  it('moves the balance to a same-currency account and archives', async () => {
    server.archiveAccount.mockResolvedValue({ ok: true, value: BCA });
    const { dialog, onDone } = await renderArchive();
    await expect.element(dialog).toHaveAccessibleDescription(/214 transaksi tetap tersimpan/);
    expect(dialog.element().textContent).toContain('Saldo tersisa Rp42.810.000');
    expect(dialog.element().textContent).toContain('Rp8.125.000');
    expect(dialog.element().textContent).toContain('Rp50.935.000');
    await userEvent.click(dialog.getByRole('combobox', { name: 'Rekening tujuan' }));
    await expect.element(page.getByRole('option', { name: 'Gotrade' })).not.toBeInTheDocument();
    await userEvent.click(page.getByRole('option', { name: 'Mandiri' }));
    await userEvent.click(dialog.getByRole('button', { name: 'Transfer & arsipkan' }));
    expect(server.archiveAccount).toHaveBeenCalledWith({
      data: {
        id: BCA.id,
        transfer: { toAccountId: MANDIRI.id, clientId: expect.any(String) as unknown },
      },
    });
    expect(server.toast).toHaveBeenCalledWith({ title: 'BCA Tahapan diarsipkan' });
    expect(onDone).toHaveBeenCalled();
  });

  it('archives without moving the balance when unchecked, and shows refusals', async () => {
    server.archiveAccount.mockResolvedValue({ ok: false, code: 'ACCOUNT_ARCHIVED' });
    const { dialog, onDone, onOpenChange } = await renderArchive();
    await userEvent.click(dialog.getByRole('checkbox', { name: /Pindahkan saldo/ }));
    await expect.element(dialog.getByRole('combobox', { name: 'Rekening tujuan' })).not.toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Arsipkan' }));
    expect(server.archiveAccount).toHaveBeenCalledWith({ data: { id: BCA.id } });
    await expect.element(dialog.getByText('Rekening ini sudah diarsipkan.')).toBeVisible();
    expect(onDone).not.toHaveBeenCalled();
    await userEvent.click(dialog.getByRole('button', { name: 'Batal' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('offers nothing to move for an empty account', async () => {
    server.archiveAccount.mockResolvedValue({ ok: true, value: JAGO });
    const empty = { ...JAGO, balanceMinor: 0n };
    const { dialog } = await renderArchive(empty, [empty]);
    await expect.element(dialog.getByText(/Saldo tersisa/)).not.toBeInTheDocument();
    await expect.element(dialog.getByRole('combobox')).not.toBeInTheDocument();
    await userEvent.click(dialog.getByRole('button', { name: 'Arsipkan' }));
    expect(server.archiveAccount).toHaveBeenCalledWith({ data: { id: JAGO.id } });
  });
});
