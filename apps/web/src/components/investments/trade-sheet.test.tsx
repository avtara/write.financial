// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { portfolioView, SPY, TODAY } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { TradeSheet } from './trade-sheet.tsx';

const props = {
  portfolio: portfolioView(), accounts: [], rates: { USD: '16350' }, today: TODAY,
  locale: 'id' as const, onOpenChange: vi.fn(),
};

describe('TradeSheet', () => {
  it('requires a goal choice, rejects a sale beyond that goal, and recovers without losing the form', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    const { screen } = await renderApp(<TradeSheet {...props} open={{ tab: 'sell', assetId: SPY.id }} onSubmit={onSubmit} />);
    await screen.getByRole('button', { name: '50%', exact: true }).click();
    await screen.getByRole('button', { name: 'Simpan jual', exact: true }).click();
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Pilih tujuan yang dikurangi');
    expect(onSubmit).not.toHaveBeenCalled();
    await screen.getByRole('radio', { name: 'Kurangi dari Dana Pensiun' }).click();
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Penjualan melebihi unit tujuan yang dipilih');
    await expect.element(screen.getByRole('button', { name: 'Simpan jual', exact: true })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
    await screen.getByRole('radio', { name: 'Kurangi dari DP Rumah' }).click();
    await screen.getByRole('button', { name: 'Simpan jual', exact: true }).click();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'sell', reduceGoalId: SPY.goals[0]?.goalId }));
  });

  it('calculates buy units, fees, taxes and DCA goal shares from an amount', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    const { screen } = await renderApp(<TradeSheet {...props} open={{ tab: 'buy', assetId: SPY.id }} onSubmit={onSubmit} />);
    await screen.getByRole('textbox', { name: 'Jumlah (USD)', exact: true }).fill('50,00');
    await screen.getByRole('textbox', { name: 'Biaya admin', exact: true }).fill('0,15');
    await screen.getByRole('textbox', { name: 'Pajak', exact: true }).fill('0,02');
    await expect.element(screen.getByRole('dialog')).toHaveTextContent('US$50,17');
    await expect.element(screen.getByRole('dialog')).toHaveTextContent('Rp820.280');
    await screen.getByRole('button', { name: 'Simpan beli', exact: true }).click();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'buy', amountMinor: 5000n, feeMinor: 15n, taxMinor: 2n, fxRate: '16350' }));
  });

  it('selling everything needs no arbitrary goal selection; adjustment opens with its sale value', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    const { screen } = await renderApp(<TradeSheet {...props} open={{ tab: 'sell', assetId: SPY.id, sellAmountMinor: 1000n }} onSubmit={onSubmit} />);
    await expect.element(screen.getByRole('textbox', { name: 'Jual senilai (USD)' })).toHaveValue('10,00');
    await screen.getByRole('button', { name: 'Semua', exact: true }).click();
    await screen.getByRole('button', { name: 'Simpan jual', exact: true }).click();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ units: SPY.holding.units, reduceGoalId: null }));
  });
});
