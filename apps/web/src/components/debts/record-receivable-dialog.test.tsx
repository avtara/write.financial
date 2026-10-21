// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { debtsOverview } from '../../../test/debt-fixtures.ts';
import { BCA, JAGO } from '../../../test/ledger-fixtures.ts';
import { receivablesOverview } from '../../../test/receivable-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { RecordReceivableDialog } from './record-receivable-dialog.tsx';

const fake = vi.hoisted(() => ({ recordReceivable: vi.fn() }));
vi.mock('../../server/fn/receivables.ts', () => fake);
vi.mock('../../server/fn/debts.ts', () => ({ createDebt: vi.fn(), convertCardTransaction: vi.fn() }));

afterEach(() => {
  vi.clearAllMocks();
});

const OVERVIEW = debtsOverview({ receivables: receivablesOverview() });

async function renderDialog(overview = OVERVIEW) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const rendered = await renderApp(
    <RecordReceivableDialog open onClose={onClose} overview={overview} locale="id" onSaved={onSaved} />,
  );
  return { ...rendered, onSaved, onClose, dialog: rendered.screen.getByRole('dialog', { name: 'Catat piutang' }) };
}

describe('RecordReceivableDialog (H7g1A)', () => {
  it('golden: Bima Aditya Rp500.000 from BCA, due at the end of October with the H-1 reminder', async () => {
    fake.recordReceivable.mockResolvedValue({ ok: true, value: 'made' });
    const { dialog, onSaved } = await renderDialog();
    await expect.element(dialog).toMatchTextContent(/pernah:Nadia·Raka Pratama·Dimas/);
    await dialog.getByRole('combobox', { name: 'Siapa' }).fill('Bima Aditya');
    await dialog.getByRole('textbox', { name: 'Jumlah' }).fill('500000');
    await dialog.getByRole('textbox', { name: 'Catatan' }).fill(' Pinjam untuk servis motor ');
    await expect
      .element(dialog.getByRole('button', { name: 'Akhir bulan · 31 Okt' }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect.element(dialog.getByRole('switch', { name: /Ingatkan aku H-1 jam 09\.00/ })).toBeChecked();
    const after = dialog.getByRole('region', { name: 'Setelah disimpan' });
    await expect.element(after).toMatchTextContent(/Saldo BCA Tahapan42\.810\.00042\.310\.000/);
    await expect.element(after).toMatchTextContent(/Piutang542\.5001\.042\.500/);
    await expect.element(after).toMatchTextContent(/Pengeluaran Oktober16\.500\.000tetap/);
    await expect.element(after).toMatchTextContent(/Kekayaan bersih48\.602\.500tetap/);
    await dialog.getByRole('button', { name: 'Catat piutang' }).click();
    await vi.waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith('made');
    });
    expect(fake.recordReceivable).toHaveBeenCalledWith({
      data: {
        clientId: expect.any(String) as unknown,
        counterparty: 'Bima Aditya',
        amountMinor: 500_000n,
        fromAccountId: BCA.id,
        lentAt: expect.any(Date) as unknown,
        dueDate: '2026-10-31',
        remind: true,
        note: 'Pinjam untuk servis motor',
      },
    });
  });

  it('asks for the person, amount, and account; a suggestion fills the name; no deadline means no reminder', async () => {
    fake.recordReceivable.mockResolvedValue({ ok: false, code: 'PERIOD_CLOSED' });
    const overview = debtsOverview({ receivables: receivablesOverview() });
    const { dialog, onClose, screen } = await renderDialog({
      ...overview,
      accounts: { ...overview.accounts, accounts: [] },
    });
    await dialog.getByRole('button', { name: 'Catat piutang' }).click();
    await expect.element(dialog.getByText('Isi siapa yang berutang')).toBeVisible();
    await expect.element(dialog.getByText('Isi jumlah lebih dari 0')).toBeVisible();
    await expect.element(dialog.getByText('Pilih rekening', { exact: true }).last()).toBeVisible();
    expect(fake.recordReceivable).not.toHaveBeenCalled();
    await dialog.getByRole('button', { name: 'Raka Pratama' }).click();
    await expect.element(dialog.getByRole('combobox', { name: 'Siapa' })).toHaveValue('Raka Pratama');
    await dialog.getByRole('button', { name: 'Tanpa tenggat' }).click();
    await expect.element(dialog.getByRole('switch')).not.toBeChecked();
    await expect.element(dialog.getByRole('switch')).toBeDisabled();
    await dialog.getByRole('button', { name: 'Batal' }).click();
    expect(onClose).toHaveBeenCalled();
    await screen.unmount();

    // A refused save says why; the date can move to the past; no people → no suggestions.
    const second = await renderDialog(debtsOverview({ accounts: { ...overview.accounts, accounts: [BCA, JAGO] } }));
    await expect.element(second.dialog).not.toMatchTextContent(/pernah:/);
    await second.dialog.getByRole('combobox', { name: 'Siapa' }).fill('Sari');
    await second.dialog.getByRole('textbox', { name: 'Jumlah' }).fill('100000');
    await second.dialog.getByRole('button', { name: '2 minggu' }).click();
    await second.dialog.getByRole('switch').click();
    await second.dialog.getByRole('button', { name: 'Dari rekening' }).click();
    await userEvent.keyboard('Bank Jago{Enter}');
    await expect
      .element(second.dialog.getByRole('region', { name: 'Setelah disimpan' }))
      .toMatchTextContent(/Saldo Bank Jago/);
    await second.dialog.getByRole('button', { name: 'Tanggal' }).click();
    await second.screen.getByRole('gridcell', { name: /14/ }).first().click();
    await second.dialog.getByRole('button', { name: 'Catat piutang' }).click();
    await expect.element(second.dialog.getByRole('alert').last()).toBeVisible();
    expect(fake.recordReceivable).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        dueDate: '2026-10-28',
        remind: false,
        note: null,
        fromAccountId: JAGO.id,
      }) as unknown,
    });
  });
});
