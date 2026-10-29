// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { BBCA, portfolioView, SCHD, SPY, TODAY } from '../../../test/investment-fixtures.ts';
import { ACCOUNTS, BCA, GOTRADE } from '../../../test/ledger-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { TradeSheet } from './trade-sheet.tsx';

const props = {
  portfolio: portfolioView(),
  accounts: [],
  rates: { USD: '16350' },
  today: TODAY,
  locale: 'id' as const,
  onOpenChange: vi.fn(),
};

describe('TradeSheet', () => {
  it('requires a goal choice, rejects a sale beyond that goal, and recovers without losing the form', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    const { screen } = await renderApp(
      <TradeSheet {...props} open={{ tab: 'sell', assetId: SPY.id }} onSubmit={onSubmit} />,
    );
    await screen.getByRole('button', { name: '50,00%', exact: true }).click();
    await screen.getByRole('button', { name: 'Simpan jual', exact: true }).click();
    await expect.element(screen.getByRole('alert')).toMatchTextContent('Pilih tujuan yang dikurangi');
    expect(onSubmit).not.toHaveBeenCalled();
    await screen.getByRole('radio', { name: 'Kurangi dari Dana Pensiun' }).click();
    await expect.element(screen.getByRole('alert')).toMatchTextContent('Penjualan melebihi unit tujuan yang dipilih');
    await expect.element(screen.getByRole('button', { name: 'Simpan jual', exact: true })).toBeDisabled();
    const form = screen.getByRole('button', { name: 'Batal' }).element().closest('form') as HTMLFormElement;
    form.requestSubmit();
    expect(onSubmit).not.toHaveBeenCalled();
    await screen.getByRole('radio', { name: 'Kurangi dari DP Rumah' }).click();
    await screen.getByRole('button', { name: 'Simpan jual', exact: true }).click();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'sell', reduceGoalId: SPY.goals[0]?.goalId }),
    );
  });

  it('calculates buy units, fees, taxes and DCA goal shares from an amount', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    const { screen } = await renderApp(
      <TradeSheet {...props} open={{ tab: 'buy', assetId: SPY.id }} onSubmit={onSubmit} />,
    );
    await screen.getByRole('textbox', { name: 'Jumlah (USD)', exact: true }).fill('50,00');
    await screen.getByRole('textbox', { name: 'Biaya admin', exact: true }).fill('0,15');
    await screen.getByRole('textbox', { name: 'Pajak', exact: true }).fill('0,02');
    await expect.element(screen.getByRole('dialog')).toMatchTextContent('US$50,17');
    await expect.element(screen.getByRole('dialog')).toMatchTextContent('Rp820.280');
    await screen.getByRole('button', { name: 'Simpan beli', exact: true }).click();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'buy', amountMinor: 5000n, feeMinor: 15n, taxMinor: 2n, fxRate: '16350' }),
    );
  });

  it('selling everything needs no arbitrary goal selection; adjustment opens with its sale value', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    const { screen } = await renderApp(
      <TradeSheet {...props} open={{ tab: 'sell', assetId: SPY.id, sellAmountMinor: 1000n }} onSubmit={onSubmit} />,
    );
    await expect.element(screen.getByRole('textbox', { name: 'Jual senilai (USD)' })).toHaveValue('10,00');
    await screen.getByRole('button', { name: 'Semua', exact: true }).click();
    await screen.getByRole('button', { name: 'Simpan jual', exact: true }).click();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ units: SPY.holding.units, reduceGoalId: null }));
  });

  it('buys by units with a pending flag, another asset, and another date', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    const { screen } = await renderApp(
      <TradeSheet {...props} accounts={ACCOUNTS} open={{ tab: 'buy', assetId: SPY.id }} onSubmit={onSubmit} />,
    );
    await screen.getByRole('radio', { name: 'Unit' }).click();
    await screen.getByRole('textbox', { name: 'Unit', exact: true }).fill('0,5');
    await screen.getByRole('checkbox', { name: /Diproses/ }).click();
    await screen.getByRole('combobox', { name: 'Aset' }).click();
    await screen.getByRole('option', { name: /^SCHD · / }).click();
    await screen.getByRole('button', { name: 'Tanggal' }).click();
    await screen.getByRole('gridcell', { name: /14/ }).first().click();
    await screen.getByRole('button', { name: 'Simpan beli' }).click();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'buy', units: '0.5', pending: true, assetId: SCHD.id }),
    );
  });

  it('refuses a buy without a price or amount and edits the price', async () => {
    const onSubmit = vi.fn();
    const { screen } = await renderApp(
      <TradeSheet {...props} open={{ tab: 'buy', assetId: SPY.id }} onSubmit={onSubmit} />,
    );
    await screen.getByRole('textbox', { name: 'Harga per unit (USD)' }).fill('');
    await screen.getByRole('button', { name: 'Simpan beli' }).click();
    await expect.element(screen.getByText('Masukkan harga per unit')).toBeVisible();
    await screen.getByRole('textbox', { name: 'Harga per unit (USD)' }).fill('abc');
    await expect.element(screen.getByText('Masukkan harga per unit')).toBeVisible();
    await screen.getByRole('textbox', { name: 'Harga per unit (USD)' }).fill('690,10');
    await screen.getByRole('button', { name: 'Simpan beli' }).click();
    await expect.element(screen.getByText('Masukkan jumlah yang valid')).toBeVisible();
    await screen.getByRole('radio', { name: 'Unit' }).click();
    await screen.getByRole('button', { name: 'Simpan beli' }).click();
    await expect.element(screen.getByText('Masukkan jumlah unit')).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('buys a domestic fund without a rate and with no platform cash', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    const { screen } = await renderApp(
      <TradeSheet {...props} open={{ tab: 'buy', assetId: BBCA.id }} onSubmit={onSubmit} />,
    );
    expect(screen.getByRole('textbox', { name: /^Kurs / }).query()).toBeNull();
    await screen.getByRole('textbox', { name: 'Jumlah (IDR)', exact: true }).fill('100000');
    await screen.getByRole('button', { name: 'Simpan beli' }).click();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ fxRate: null }));
  });

  it('sells into a bank account and edits the price before selling', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    const { screen } = await renderApp(
      <TradeSheet {...props} accounts={ACCOUNTS} open={{ tab: 'sell', assetId: BBCA.id }} onSubmit={onSubmit} />,
    );
    await screen.getByRole('textbox', { name: 'Harga per unit (IDR)' }).fill('8025');
    await screen.getByRole('button', { name: '25,00%', exact: true }).click();
    await screen.getByRole('textbox', { name: 'Harga per unit (IDR)' }).fill('');
    await screen.getByRole('textbox', { name: 'Harga per unit (IDR)' }).fill('8025');
    await screen.getByRole('radio', { name: 'Tarik ke rekening' }).click();
    await screen.getByRole('button', { name: 'Simpan jual' }).click();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'sell', proceedsAccountId: BCA.id, fxRate: null }),
    );
  });

  it('records a dividend as cash, a DRIP, or money into an account', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    const { screen } = await renderApp(
      <TradeSheet {...props} accounts={ACCOUNTS} open={{ tab: 'dividend', assetId: BBCA.id }} onSubmit={onSubmit} />,
    );
    await screen.getByRole('textbox', { name: 'Dividen kotor (IDR)' }).fill('50000');
    await screen.getByRole('textbox', { name: 'Biaya admin' }).fill('1000');
    await screen.getByRole('button', { name: 'Simpan dividen' }).click();
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'cash', units: null, accountId: null }));
    await screen.getByRole('radio', { name: 'Diinvestasikan ulang (DRIP)' }).click();
    await screen.getByRole('button', { name: 'Simpan dividen' }).click();
    await expect.element(screen.getByText('Masukkan jumlah unit')).toBeVisible();
    await screen.getByRole('textbox', { name: /Unit yang dibeli/ }).fill('0,5');
    await screen.getByRole('button', { name: 'Simpan dividen' }).click();
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'reinvest', units: '0.5' }));
    await screen.getByRole('radio', { name: 'Masuk ke rekening' }).click();
    await screen.getByRole('button', { name: 'Simpan dividen' }).click();
    expect(onSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'account', accountId: BCA.id, units: null }),
    );
  });

  it('tops up platform cash across currencies and validates the received amount', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    const { screen } = await renderApp(
      <TradeSheet {...props} accounts={ACCOUNTS} open={{ tab: 'cash_topup', assetId: null }} onSubmit={onSubmit} />,
    );
    await screen.getByRole('combobox', { name: 'Platform' }).click();
    await screen.getByRole('option', { name: GOTRADE.displayName }).click();
    await screen.getByRole('combobox', { name: 'Dari rekening' }).click();
    await screen.getByRole('option', { name: BCA.displayName }).click();
    await screen.getByRole('textbox', { name: /^Dikirim/ }).fill('100000');
    await screen.getByRole('button', { name: 'Simpan top-up' }).click();
    await expect.element(screen.getByText('Masukkan jumlah yang valid')).toBeVisible();
    await screen.getByRole('textbox', { name: /^Diterima/ }).fill('6,12');
    await screen.getByRole('button', { name: 'Simpan top-up' }).click();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'cash_topup', fromAccountId: BCA.id, receivedMinor: 612n }),
    );
  });

  it('renders no sheet while closed, defaults the asset, and falls back with none', async () => {
    const closed = await renderApp(<TradeSheet {...props} open={null} onSubmit={vi.fn()} />);
    await expect.element(closed.screen.getByRole('dialog')).not.toBeInTheDocument();
    await closed.screen.unmount();
    const defaults = await renderApp(<TradeSheet {...props} open={{ tab: 'buy', assetId: null }} onSubmit={vi.fn()} />);
    await expect.element(defaults.screen.getByRole('combobox', { name: 'Aset' })).toMatchTextContent('SPY');
    await defaults.screen.unmount();
    const empty = await renderApp(
      <TradeSheet
        {...props}
        portfolio={portfolioView({ assets: [], platforms: [] })}
        open={{ tab: 'buy', assetId: null }}
        onSubmit={vi.fn()}
      />,
    );
    await expect.element(empty.screen.getByRole('dialog')).toBeVisible();
  });

  it('picks an unpriced foreign asset and refuses a bad rate', async () => {
    const bare = { ...SCHD, quote: null, averagePrice: null, quoteCurrency: 'EUR' };
    const onSubmit = vi.fn();
    const { screen } = await renderApp(
      <TradeSheet
        {...props}
        portfolio={portfolioView({ assets: [SPY, bare] })}
        open={{ tab: 'buy', assetId: SPY.id }}
        onSubmit={onSubmit}
      />,
    );
    await screen.getByRole('combobox', { name: 'Aset' }).click();
    await screen.getByRole('option', { name: /^SCHD · / }).click();
    await expect.element(screen.getByRole('textbox', { name: 'Harga per unit (EUR)' })).toHaveValue('');
    await expect.element(screen.getByRole('textbox', { name: 'Kurs EUR' })).toHaveValue('');
    await screen.getByRole('textbox', { name: 'Harga per unit (EUR)' }).fill('10');
    await screen.getByRole('textbox', { name: 'Kurs EUR' }).fill('abc');
    await screen.getByRole('textbox', { name: 'Jumlah (EUR)', exact: true }).fill('100');
    await screen.getByRole('button', { name: 'Simpan beli' }).click();
    await expect.element(screen.getByText('Masukkan kurs (maks. 8 desimal)')).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('has no platform cash for an asset the platforms do not know, and shows a refusal', async () => {
    const stray = { ...SPY, accountId: 'missing-account' };
    const onSubmit = vi.fn().mockResolvedValue('Tidak tersimpan.');
    const { screen } = await renderApp(
      <TradeSheet
        {...props}
        portfolio={portfolioView({ assets: [stray] })}
        open={{ tab: 'buy', assetId: stray.id }}
        onSubmit={onSubmit}
      />,
    );
    await expect.element(screen.getByText(/^Bayar dari saldo kas/)).not.toBeInTheDocument();
    await screen.getByRole('textbox', { name: 'Jumlah (USD)', exact: true }).fill('50');
    await screen.getByRole('button', { name: 'Simpan beli' }).click();
    await expect.element(screen.getByText('Tidak tersimpan.')).toBeVisible();
  });

  it('sells into an account only when one exists, and reports a refusal in English', async () => {
    const onSubmit = vi.fn().mockResolvedValue('Tidak tersimpan.');
    const { screen } = await renderApp(
      <TradeSheet {...props} open={{ tab: 'sell', assetId: BBCA.id }} onSubmit={onSubmit} />,
    );
    await screen.getByRole('textbox', { name: 'Harga per unit (IDR)' }).fill('');
    await screen.getByRole('button', { name: 'Simpan jual' }).click();
    await expect.element(screen.getByText('Masukkan harga per unit')).toBeVisible();
    await screen.getByRole('textbox', { name: 'Harga per unit (IDR)' }).fill('8025');
    await screen.getByRole('button', { name: '25,00%', exact: true }).click();
    await screen.getByRole('textbox', { name: 'Harga per unit (IDR)' }).fill('');
    await screen.getByRole('textbox', { name: 'Harga per unit (IDR)' }).fill('8025');
    await screen.getByRole('radio', { name: 'Tarik ke rekening' }).click();
    await screen.getByRole('button', { name: 'Simpan jual' }).click();
    expect(onSubmit).not.toHaveBeenCalled();
    await screen.getByRole('textbox', { name: 'Jual senilai (IDR)' }).fill('10000');
    await screen.getByRole('radio', { name: /^Saldo IDR/ }).click();
  });

  it('asks for an account when a dividend goes to a bank with none available', async () => {
    const { screen } = await renderApp(
      <TradeSheet {...props} open={{ tab: 'dividend', assetId: BBCA.id }} onSubmit={vi.fn()} />,
    );
    await screen.getByRole('textbox', { name: 'Dividen kotor (IDR)' }).fill('50000');
    await screen.getByRole('radio', { name: 'Masuk ke rekening' }).click();
    const form = screen.getByRole('button', { name: 'Batal' }).element().closest('form') as HTMLFormElement;
    form.requestSubmit();
    await expect.element(screen.getByText('Pilih rekening').last()).toBeVisible();
  });

  it('tops up a same-currency platform from a chosen account', async () => {
    const platform = portfolioView().platforms.find((candidate) => candidate.currency === 'IDR');
    const onSubmit = vi.fn().mockResolvedValue(null);
    const { screen } = await renderApp(
      <TradeSheet
        {...props}
        accounts={ACCOUNTS}
        open={{
          tab: 'cash_topup',
          assetId: null,
          ...(platform === undefined ? {} : { accountId: platform.accountId }),
        }}
        onSubmit={onSubmit}
      />,
    );
    await screen.getByRole('combobox', { name: 'Dari rekening' }).click();
    await screen.getByRole('option', { name: BCA.displayName }).click();
    expect(screen.getByRole('textbox', { name: /^Diterima/ }).query()).toBeNull();
    await screen.getByRole('textbox', { name: /^Dikirim/ }).fill('100000');
    await screen.getByRole('button', { name: 'Simpan top-up' }).click();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'cash_topup', sentMinor: 100_000n, receivedMinor: 100_000n }),
    );
    await screen.unmount();
    const empty = await renderApp(
      <TradeSheet
        {...props}
        portfolio={portfolioView({ assets: [], platforms: [] })}
        accounts={[]}
        open={{ tab: 'cash_topup', assetId: null }}
        onSubmit={vi.fn()}
      />,
    );
    await empty.screen.getByRole('button', { name: 'Simpan top-up' }).click();
    await expect.element(empty.screen.getByText('Pilih platform')).toBeVisible();
    await expect.element(empty.screen.getByText('Pilih rekening sumber')).toBeVisible();
  });

  it('labels the sold share in the sheet’s locale', async () => {
    const { screen } = await renderApp(
      <TradeSheet
        {...props}
        locale="en"
        open={{ tab: 'sell', assetId: BBCA.id }}
        onSubmit={vi.fn().mockResolvedValue(null)}
      />,
      { preferences: { locale: 'en' } },
    );
    await screen.getByRole('button', { name: '50.00%', exact: true }).click();
    await expect.element(screen.getByRole('dialog')).toMatchTextContent('50% of the position');
  });

  it('cancels, switches tabs, and falls back without an asset in the sell and dividend forms', async () => {
    const onOpenChange = vi.fn();
    const { screen } = await renderApp(
      <TradeSheet {...props} open={{ tab: 'buy', assetId: SPY.id }} onSubmit={vi.fn()} onOpenChange={onOpenChange} />,
    );
    await screen.getByRole('tab', { name: 'Dividen' }).click();
    await expect.element(screen.getByRole('tab', { name: 'Dividen' })).toHaveAttribute('aria-selected', 'true');
    await screen.getByRole('button', { name: 'Batal' }).click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await screen.unmount();
    const empty = portfolioView({ assets: [], platforms: [] });
    const sell = await renderApp(
      <TradeSheet {...props} portfolio={empty} open={{ tab: 'sell', assetId: null }} onSubmit={vi.fn()} />,
    );
    await expect.element(sell.screen.getByRole('dialog')).toBeVisible();
    await sell.screen.unmount();
    const dividend = await renderApp(
      <TradeSheet {...props} portfolio={empty} open={{ tab: 'dividend', assetId: null }} onSubmit={vi.fn()} />,
    );
    await expect.element(dividend.screen.getByRole('dialog')).toBeVisible();
  });

  it('reinvests a foreign dividend with no fee or tax', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    const { screen } = await renderApp(
      <TradeSheet {...props} open={{ tab: 'dividend', assetId: SPY.id }} onSubmit={onSubmit} />,
    );
    await screen.getByRole('radio', { name: 'Diinvestasikan ulang (DRIP)' }).click();
    await screen.getByRole('textbox', { name: 'Dividen kotor (USD)' }).fill('10');
    await screen.getByRole('textbox', { name: /Unit yang dibeli/ }).fill('0,1');
    await screen.getByRole('button', { name: 'Simpan dividen' }).click();
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'dividend', mode: 'reinvest', units: '0.1', feeMinor: 0n, fxRate: '16350' }),
    );
  });
});
