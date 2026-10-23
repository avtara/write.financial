// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { portfolioView, SPY } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { AssetForm } from './asset-form.tsx';

describe('AssetForm', () => {
  it('rejects an empty ticker and requires a price for manual valuation', async () => {
    const portfolio = portfolioView();
    const submit = vi.fn().mockResolvedValue(null);
    const { screen } = await renderApp(
      <AssetForm
        open={{ asset: SPY }}
        platforms={portfolio.platforms}
        categories={portfolio.categories}
        locale="id"
        onOpenChange={vi.fn()}
        onSubmit={submit}
      />,
    );
    await screen.getByRole('textbox', { name: 'Ticker', exact: true }).fill('');
    await screen.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect.element(screen.getByText('Isi ticker, maks. 20 karakter')).toBeVisible();
    expect(submit).not.toHaveBeenCalled();
    await screen.getByRole('textbox', { name: 'Ticker', exact: true }).fill('SPY');
    await screen.getByRole('textbox', { name: 'Harga manual (USD)', exact: true }).fill('');
    await screen.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect.element(screen.getByText('Harga manual wajib untuk sumber Manual')).toBeVisible();
    expect(submit).not.toHaveBeenCalled();
  });

  it('edits an asset, moves its category, and reports a refusal; Batal closes', async () => {
    const portfolio = portfolioView();
    const category = portfolio.categories[0];
    const onOpenChange = vi.fn();
    const submit = vi.fn().mockResolvedValueOnce('Tidak tersimpan.').mockResolvedValueOnce(null);
    const { screen } = await renderApp(
      <AssetForm
        open={{ asset: SPY }}
        platforms={portfolio.platforms}
        categories={portfolio.categories}
        locale="id"
        onOpenChange={onOpenChange}
        onSubmit={submit}
      />,
    );
    await screen.getByRole('textbox', { name: 'Nama', exact: true }).fill('SPDR Baru');
    await screen.getByRole('combobox', { name: 'Sumber harga' }).click();
    await screen.getByRole('option', { name: 'Bawaan server' }).click();
    await screen.getByRole('combobox', { name: 'Kategori “Daftar saya”' }).click();
    await screen.getByRole('option', { name: category?.name as string }).click();
    await screen.getByRole('textbox', { name: 'Harga manual (USD)', exact: true }).fill('700');
    await screen.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect.element(screen.getByText('Tidak tersimpan.')).toBeVisible();
    await screen.getByRole('button', { name: 'Simpan', exact: true }).click();
    expect(submit).toHaveBeenLastCalledWith({
      accountId: null,
      symbol: 'SPY',
      name: 'SPDR Baru',
      assetClass: SPY.assetClass,
      market: SPY.market,
      categoryId: category?.id,
      priceMode: 'server',
      manualPrice: '700',
    });
    await screen.getByRole('button', { name: 'Batal' }).click();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('creates an asset: requires a platform, then sends the chosen one and no category', async () => {
    const portfolio = portfolioView();
    const submit = vi.fn().mockResolvedValue(null);
    const { screen } = await renderApp(
      <AssetForm
        open={{ asset: null }}
        platforms={portfolio.platforms}
        categories={portfolio.categories}
        locale="id"
        onOpenChange={vi.fn()}
        onSubmit={submit}
      />,
    );
    await screen.getByRole('textbox', { name: 'Ticker', exact: true }).fill('aapl');
    await screen.getByRole('textbox', { name: 'Nama', exact: true }).fill('Apple');
    await screen.getByRole('textbox', { name: /^Harga manual/ }).fill('abc');
    await screen.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect.element(screen.getByText('Masukkan harga per unit')).toBeVisible();
    await screen.getByRole('textbox', { name: /^Harga manual/ }).fill('210,5');
    await screen.getByRole('button', { name: 'Simpan', exact: true }).click();
    expect(submit).toHaveBeenLastCalledWith({
      accountId: portfolio.platforms[0]?.accountId,
      symbol: 'AAPL',
      name: 'Apple',
      assetClass: 'us_stocks',
      market: 'us_equity',
      categoryId: null,
      priceMode: 'manual',
      manualPrice: '210.5',
    });
    await screen.unmount();
    const noPlatform = await renderApp(
      <AssetForm
        open={{ asset: null }}
        platforms={[]}
        categories={[]}
        locale="id"
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    await noPlatform.screen.getByRole('textbox', { name: 'Ticker', exact: true }).fill('AAPL');
    await noPlatform.screen.getByRole('textbox', { name: 'Nama', exact: true }).fill('Apple');
    await noPlatform.screen.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect.element(noPlatform.screen.getByText('Pilih platform (rekening investasi)')).toBeVisible();
  });

  it('renders nothing while closed', async () => {
    const { screen } = await renderApp(
      <AssetForm open={null} platforms={[]} categories={[]} locale="id" onOpenChange={vi.fn()} onSubmit={vi.fn()} />,
    );
    await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
  });
});
