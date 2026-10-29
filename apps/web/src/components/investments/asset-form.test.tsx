// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { BBCA, portfolioView, SPY } from '../../../test/investment-fixtures.ts';
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
    await screen.getByRole('combobox', { name: 'Ticker', exact: true }).fill('');
    await screen.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect.element(screen.getByText('Isi ticker, maks. 20 karakter')).toBeVisible();
    expect(submit).not.toHaveBeenCalled();
    await screen.getByRole('combobox', { name: 'Ticker', exact: true }).fill('SPY');
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
    await screen.getByRole('combobox', { name: 'Nama', exact: true }).fill('SPDR Baru');
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
      catalogId: null,
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
    await screen.getByRole('combobox', { name: 'Ticker', exact: true }).fill('aapl');
    await screen.getByRole('combobox', { name: 'Nama', exact: true }).fill('Apple');
    await screen.getByRole('textbox', { name: /^Harga manual/ }).fill('abc');
    await screen.getByRole('button', { name: 'Simpan', exact: true }).click();
    await expect.element(screen.getByText('Masukkan harga per unit')).toBeVisible();
    await screen.getByRole('textbox', { name: /^Harga manual/ }).fill('210,5');
    await screen.getByRole('button', { name: 'Simpan', exact: true }).click();
    expect(submit).toHaveBeenLastCalledWith({
      accountId: portfolio.platforms[0]?.accountId,
      symbol: 'AAPL',
      catalogId: null,
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
    await noPlatform.screen.getByRole('combobox', { name: 'Ticker', exact: true }).fill('AAPL');
    await noPlatform.screen.getByRole('combobox', { name: 'Nama', exact: true }).fill('Apple');
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

describe('catalog listing prefill', () => {
  it('searches by company in the platform currency and keeps the user-entered manual price', async () => {
    const portfolio = portfolioView();
    const submit = vi.fn().mockResolvedValue(null);
    const { screen } = await renderApp(
      <AssetForm
        open={{ asset: { ...BBCA, catalogId: 'stock:xidx:bbca' } }}
        platforms={portfolio.platforms}
        categories={portfolio.categories}
        locale="id"
        onOpenChange={vi.fn()}
        onSubmit={submit}
      />,
    );
    await screen.getByRole('textbox', { name: 'Harga manual (IDR)', exact: true }).fill('9.123');
    const name = screen.getByRole('combobox', { name: 'Nama', exact: true });
    await name.fill('Apple');
    await expect.element(screen.getByRole('option')).not.toBeInTheDocument();
    await name.fill('Telkom');
    await screen.getByRole('option', { name: /TLKM · Telkom Indonesia/ }).click();
    await expect.element(screen.getByRole('combobox', { name: 'Ticker', exact: true })).toHaveValue('TLKM');
    await expect.element(name).toHaveValue('Telkom Indonesia');
    await expect.element(screen.getByRole('textbox', { name: 'Harga manual (IDR)', exact: true })).toHaveValue('9.123');
    await screen.getByRole('button', { name: 'Simpan', exact: true }).click();
    expect(submit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        symbol: 'TLKM',
        name: 'Telkom Indonesia',
        catalogId: 'stock:xidx:tlkm',
        assetClass: 'indonesia',
        market: 'idx_equity',
        manualPrice: '9123',
        accountId: null,
      }),
    );
    await name.fill('My Telkom holding');
    await screen.getByRole('button', { name: 'Simpan', exact: true }).click();
    expect(submit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        catalogId: 'stock:xidx:tlkm',
        name: 'My Telkom holding',
      }),
    );
    await screen.getByRole('combobox', { name: 'Ticker', exact: true }).fill('CUSTOM');
    await screen.getByRole('button', { name: 'Simpan', exact: true }).click();
    expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ symbol: 'CUSTOM', catalogId: null }));
  });

  it('does not set a price, permits manual fields, and drops associations on class/market overrides', async () => {
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
    const ticker = screen.getByRole('combobox', { name: 'Ticker', exact: true });
    await ticker.fill('aapl');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await expect.element(screen.getByRole('textbox', { name: 'Harga manual (USD)', exact: true })).toHaveValue('');
    await screen.getByRole('combobox', { name: 'Sumber harga' }).click();
    await screen.getByRole('option', { name: 'Key pribadi (BYOK)' }).click();
    await screen.getByRole('button', { name: 'Simpan', exact: true }).click();
    expect(submit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        catalogId: 'stock:xnas:aapl',
        symbol: 'AAPL',
        name: 'Apple',
        manualPrice: null,
      }),
    );
    await screen.getByRole('combobox', { name: 'Kelas aset' }).click();
    await screen.getByRole('option', { name: 'Indonesia', exact: true }).click();
    await screen.getByRole('button', { name: 'Simpan', exact: true }).click();
    expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ assetClass: 'indonesia', catalogId: null }));
    await ticker.fill('aapl');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await screen.getByRole('combobox', { name: 'Pasar harga' }).click();
    await screen.getByRole('option', { name: 'Saham BEI', exact: true }).click();
    await screen.getByRole('button', { name: 'Simpan', exact: true }).click();
    expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ market: 'idx_equity', catalogId: null }));
  });

  it('retains a listing on a same-currency platform and detaches it when the platform quote currency changes', async () => {
    const portfolio = portfolioView();
    const usd = portfolio.platforms[0] as (typeof portfolio.platforms)[number];
    const platforms = [
      usd,
      { ...usd, accountId: 'usd-two', name: 'USD Two' },
      { ...usd, accountId: 'idr', name: 'IDR Platform', currency: 'IDR' },
    ];
    const submit = vi.fn().mockResolvedValue(null);
    const { screen } = await renderApp(
      <AssetForm
        open={{ asset: null }}
        platforms={platforms}
        categories={[]}
        locale="id"
        onOpenChange={vi.fn()}
        onSubmit={submit}
      />,
    );
    await screen.getByRole('combobox', { name: 'Ticker', exact: true }).fill('Apple');
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await screen.getByRole('textbox', { name: 'Harga manual (USD)', exact: true }).fill('100');
    await screen.getByRole('combobox', { name: 'Platform' }).click();
    await screen.getByRole('option', { name: 'USD Two', exact: true }).click();
    await screen.getByRole('button', { name: 'Simpan', exact: true }).click();
    expect(submit).toHaveBeenLastCalledWith(
      expect.objectContaining({ accountId: 'usd-two', catalogId: 'stock:xnas:aapl' }),
    );
    await screen.getByRole('combobox', { name: 'Platform' }).click();
    await screen.getByRole('option', { name: 'IDR Platform', exact: true }).click();
    await screen.getByRole('button', { name: 'Simpan', exact: true }).click();
    expect(submit).toHaveBeenLastCalledWith(
      expect.objectContaining({ accountId: 'idr', catalogId: null, manualPrice: '100' }),
    );
    await screen.getByRole('combobox', { name: 'Platform' }).click();
    await screen.getByRole('option', { name: 'USD Two', exact: true }).click();
    await screen.getByRole('button', { name: 'Simpan', exact: true }).click();
    expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: 'usd-two', catalogId: null }));
  });
});

it('uses a persisted asset quote currency when its platform is absent from selectable platforms', async () => {
  const submit = vi.fn().mockResolvedValue(null);
  const { screen } = await renderApp(
    <AssetForm
      open={{ asset: { ...BBCA, catalogId: 'stock:xidx:bbca' } }}
      platforms={[]}
      categories={[]}
      locale="id"
      onOpenChange={vi.fn()}
      onSubmit={submit}
    />,
  );
  await expect.element(screen.getByText('XIDX · IDR', { exact: true })).toBeVisible();
  await screen.getByRole('combobox', { name: 'Nama', exact: true }).fill('Telkom');
  await screen.getByRole('option', { name: /TLKM · Telkom Indonesia/ }).click();
  await screen.getByRole('button', { name: 'Simpan', exact: true }).click();
  expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ catalogId: 'stock:xidx:tlkm', accountId: null }));
});
