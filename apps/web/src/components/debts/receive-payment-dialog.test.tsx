// SPDX-License-Identifier: AGPL-3.0-only
import type { ReceivableView } from '@wf/db/receivables';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { debtsOverview } from '../../../test/debt-fixtures.ts';
import { BCA, GOTRADE } from '../../../test/ledger-fixtures.ts';
import { GOPAY, NADIA, RAKA, receivablesOverview } from '../../../test/receivable-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { ReceivePaymentDialog } from './receive-payment-dialog.tsx';

const fake = vi.hoisted(() => ({ receiveReceivablePayment: vi.fn() }));
vi.mock('../../server/fn/receivables.ts', () => fake);

afterEach(() => {
  vi.clearAllMocks();
});

const OVERVIEW = debtsOverview({
  accounts: { baseCurrency: 'IDR', accounts: [BCA, GOPAY, GOTRADE], availableMinor: 0n, missingRates: [] },
  receivables: receivablesOverview(),
});

async function renderDialog(receivable: ReceivableView | null, overview = OVERVIEW) {
  const onSaved = vi.fn();
  const onClose = vi.fn();
  const rendered = await renderApp(
    <ReceivePaymentDialog
      receivable={receivable}
      onClose={onClose}
      overview={overview}
      locale="id"
      onSaved={onSaved}
    />,
  );
  return { ...rendered, onSaved, onClose };
}

describe('ReceivePaymentDialog (ivnWw)', () => {
  it('golden: Raka Rp200.000 into GoPay → 100.000 left (75%), GoPay 612.000, October income unchanged', async () => {
    fake.receiveReceivablePayment.mockResolvedValue({ ok: true, value: 'paid' });
    const { screen, onSaved } = await renderDialog(RAKA);
    const dialog = screen.getByRole('dialog', { name: 'Terima pembayaran · Raka Pratama' });
    await expect.element(dialog).toMatchTextContent(/Sisa Rp300\.000 dari Rp400\.000 · tempo 31 Okt/);
    const chips = dialog.getByRole('group', { name: 'Jumlah cepat' });
    await expect.element(chips).toMatchTextContent(/^Lunas · Rp300\.000Rp100\.000Rp200\.000$/);
    await expect
      .element(chips.getByRole('button', { name: 'Lunas · Rp300.000' }))
      .toHaveAttribute('aria-pressed', 'true');
    await chips.getByRole('button', { name: 'Rp200.000' }).click();
    await expect.element(dialog.getByRole('button', { name: 'Masuk ke' })).toMatchTextContent(/GoPay/);
    const after = dialog.getByRole('region', { name: 'Setelah disimpan' });
    await expect.element(after).toMatchTextContent(/Sisa piutang Raka300\.000100\.000/);
    await expect.element(after).toMatchTextContent(/Saldo GoPay412\.000612\.000/);
    await expect.element(after).toMatchTextContent(/Pemasukan Oktober26\.000\.000tetap/);
    await expect.element(after).toMatchTextContent(/75,00% kembali · sisa Rp100\.000 tetap jatuh tempo 31 Okt/);
    await dialog.getByRole('button', { name: 'Terima Rp200.000' }).click();
    await vi.waitFor(() => {
      expect(onSaved).toHaveBeenCalledWith('paid');
    });
    expect(fake.receiveReceivablePayment).toHaveBeenCalledWith({
      data: {
        id: RAKA.id,
        clientId: expect.any(String) as unknown,
        amountMinor: 200_000n,
        accountId: GOPAY.id,
        receivedAt: expect.any(Date) as unknown,
      },
    });
  });

  it('settles in full, refuses too much or nothing, says why a save failed, and closes', async () => {
    fake.receiveReceivablePayment.mockResolvedValue({ ok: false, code: 'PERIOD_CLOSED' });
    const { screen, onClose } = await renderDialog(NADIA);
    const dialog = screen.getByRole('dialog', { name: 'Terima pembayaran · Nadia' });
    await expect
      .element(dialog.getByRole('region', { name: 'Setelah disimpan' }))
      .toMatchTextContent(/Lunas — piutang selesai/);
    const amount = dialog.getByRole('textbox', { name: 'Jumlah diterima' });
    await amount.fill('300000');
    await expect.element(dialog.getByRole('button', { name: 'Terima pembayaran' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Terima pembayaran' }).click();
    await expect.element(dialog.getByText('Lebih dari sisa piutang')).toBeVisible();
    await amount.clear();
    await expect.element(dialog.getByText('Isi jumlah lebih dari 0')).toBeVisible();
    await dialog.getByRole('button', { name: 'Masuk ke' }).click();
    await userEvent.keyboard('BCA{Enter}');
    await dialog.getByRole('button', { name: 'Lunas · Rp242.500' }).click();
    await dialog.getByRole('button', { name: 'Tanggal' }).click();
    await screen.getByRole('gridcell', { name: /14/ }).first().click();
    await dialog.getByRole('button', { name: 'Terima Rp242.500' }).click();
    await expect.element(dialog.getByRole('alert').last()).toBeVisible();
    expect(fake.receiveReceivablePayment).toHaveBeenCalledWith({
      data: expect.objectContaining({ accountId: BCA.id, amountMinor: 242_500n }) as unknown,
    });
    await dialog.getByRole('button', { name: 'Batal' }).click();
    expect(onClose).toHaveBeenCalled();
  });

  it('needs an account in the receivable’s currency and words a receivable without a due date', async () => {
    const noDue = { ...RAKA, dueDate: null };
    const { screen } = await renderDialog(noDue, {
      ...OVERVIEW,
      accounts: { ...OVERVIEW.accounts, accounts: [GOTRADE] },
    });
    const dialog = screen.getByRole('dialog');
    await expect.element(dialog).not.toMatchTextContent(/tempo/);
    await dialog.getByRole('button', { name: 'Rp100.000' }).click();
    await expect
      .element(dialog.getByRole('region', { name: 'Setelah disimpan' }))
      .toMatchTextContent(/50,00% kembali · sisa Rp200\.000$/);
    await dialog.getByRole('button', { name: 'Terima Rp100.000' }).click();
    await expect.element(dialog.getByText('Pilih rekening', { exact: true }).last()).toBeVisible();
    expect(fake.receiveReceivablePayment).not.toHaveBeenCalled();
    await screen.unmount();
    const elsewhere = await renderDialog(RAKA, { ...OVERVIEW, accounts: { ...OVERVIEW.accounts, accounts: [BCA] } });
    await expect.element(elsewhere.screen.getByRole('button', { name: 'Masuk ke' })).toMatchTextContent(/BCA Tahapan/);
    await elsewhere.screen.unmount();
    const closed = await renderDialog(null);
    await expect.element(closed.screen.getByRole('dialog')).not.toBeInTheDocument();
  });
});
