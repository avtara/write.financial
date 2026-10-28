// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { BBCA, portfolioView, SPY } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { HoldingsTable } from './holdings-table.tsx';

describe('HoldingsTable', () => {
  it('filters categories as well as tickers and recovers from no matches', async () => {
    const { screen } = await renderApp(
      <HoldingsTable
        portfolio={portfolioView()}
        display="base"
        usdRate="16350"
        locale="id"
        onAction={vi.fn()}
        onTopUp={vi.fn()}
        onAddAsset={vi.fn()}
      />,
    );
    const search = screen.getByRole('searchbox', { name: 'Cari ticker atau nama' });
    await search.fill('yield');
    await expect.element(screen.getByText('YieldMax', { exact: true })).toBeVisible();
    await search.fill('no-such-position');
    await expect.element(screen.getByText('Tidak ada aset untuk “no-such-position”.')).toBeVisible();
    await search.fill('SPY');
    await expect.element(screen.getByRole('table')).toMatchTextContent('SPDR S&P 500 ETF');
  });

  it('keeps the currency symbol on mixed gains, five-letter tickers, the platform, and a one-line target', async () => {
    await page.viewport(768, 1000);
    const { screen } = await renderApp(
      <HoldingsTable
        portfolio={portfolioView()}
        display="base"
        usdRate="16350"
        locale="id"
        onAction={vi.fn()}
        onTopUp={vi.fn()}
        onAddAsset={vi.fn()}
      />,
    );
    const table = screen.getByRole('table');
    // Dollar and rupiah gains share the column, so each keeps its symbol.
    await expect.element(table).toMatchTextContent('+US$128,44');
    await expect.element(table).toMatchTextContent('+Rp1.610.000');
    // The badge shows the whole five-letter ticker before the ticker button.
    await expect.element(table).toMatchTextContent('GOOGLGOOGL');
    // Below 1024 px the platform joins the subtitle.
    await expect.element(table).toMatchTextContent('SPDR S&P 500 ETF · Gotrade');
    await screen.getByRole('button', { name: 'Kelas aset', exact: true }).click();
    await expect.element(table).toMatchTextContent(/\d% · target 12%/);
  });

  it('keeps each group heading inside its cell on a 1024 px tablet', async () => {
    await page.viewport(1024, 900);
    // The Investasi page's content column at 1024 px: the rail and the page padding taken off.
    const { screen } = await renderApp(
      <div style={{ width: 880 }}>
        <HoldingsTable
          portfolio={portfolioView()}
          display="base"
          usdRate="16350"
          locale="id"
          onAction={vi.fn()}
          onTopUp={vi.fn()}
          onAddAsset={vi.fn()}
        />
      </div>,
    );
    // "Daftar saya" groups by category ("Indonesia · kategori · 5 aset"), "Kelas aset" by class.
    for (const grouping of ['Daftar saya', 'Kelas aset']) {
      await screen.getByRole('button', { name: grouping, exact: true }).click();
      const toggles = screen.getByRole('button', { name: /^(Tutup|Buka) / }).elements();
      expect(toggles.length).toBeGreaterThan(0);
      for (const toggle of toggles) {
        const cell = toggle.closest('td') as HTMLTableCellElement;
        // The count chip wraps under the title instead of running into the Platform column.
        expect(cell.scrollWidth).toBeLessThanOrEqual(cell.clientWidth);
      }
    }
  });

  it('opens a holding, tops up cash, groups, collapses, and runs menu actions', async () => {
    await page.viewport(1440, 1000);
    const onAction = vi.fn();
    const onTopUp = vi.fn();
    const onAddAsset = vi.fn();
    const { screen } = await renderApp(
      <HoldingsTable
        portfolio={portfolioView()}
        display="base"
        usdRate="16350"
        locale="id"
        onAction={onAction}
        onTopUp={onTopUp}
        onAddAsset={onAddAsset}
      />,
    );
    await screen.getByRole('button', { name: 'SPY', exact: true }).click();
    expect(onAction).toHaveBeenCalledWith('detail', expect.objectContaining({ symbol: 'SPY' }));
    await screen
      .getByRole('button', { name: /^Top-up kas / })
      .first()
      .click();
    expect(onTopUp).toHaveBeenCalledOnce();
    await screen.getByRole('button', { name: 'Tambah aset', exact: true }).click();
    expect(onAddAsset).toHaveBeenCalledOnce();

    await screen.getByRole('button', { name: 'Kelas aset', exact: true }).click();
    const collapse = screen.getByRole('button', { name: /^Tutup / }).first();
    await collapse.click();
    await expect
      .element(screen.getByRole('button', { name: /^Buka / }).first())
      .toHaveAttribute('aria-expanded', 'false');
    await screen
      .getByRole('button', { name: /^Buka / })
      .first()
      .click();
    await expect
      .element(screen.getByRole('button', { name: /^Tutup / }).first())
      .toHaveAttribute('aria-expanded', 'true');

    await screen.getByRole('button', { name: 'Menu SPY', exact: true }).click();
    await screen.getByRole('menuitem', { name: 'Beli lagi', exact: true }).click();
    expect(onAction).toHaveBeenLastCalledWith('buy', expect.objectContaining({ symbol: 'SPY' }));
    await screen.getByRole('button', { name: 'Menu SPY', exact: true }).click();
    await screen.getByRole('menuitem', { name: 'Hapus aset', exact: true }).click();
    expect(onAction).toHaveBeenLastCalledWith('remove', expect.objectContaining({ symbol: 'SPY' }));
  });

  it('marks pending and unpriced holdings, shows a zero-value portfolio, and works per platform', async () => {
    await page.viewport(1440, 1000);
    const base = portfolioView();
    const realized = {
      ...SPY,
      holding: { ...SPY.holding, realizedMinor: 100_000n, realizedBaseMinor: 1_630_000n },
    };
    const unpriced = {
      ...BBCA,
      quote: null,
      value: null,
      pendingMinor: 500_000n,
      holding: { ...BBCA.holding, units: '5', realizedMinor: 0n, realizedBaseMinor: 0n },
    };
    const onAction = vi.fn();
    const { screen } = await renderApp(
      <HoldingsTable
        portfolio={{
          ...base,
          targets: {},
          assets: [realized, unpriced],
          summary: { ...base.summary, valueBaseMinor: 0n },
        }}
        display="usd"
        usdRate="16350"
        locale="id"
        onAction={onAction}
        onTopUp={vi.fn()}
        onAddAsset={vi.fn()}
      />,
    );
    const table = screen.getByRole('table');
    await expect.element(table).toMatchTextContent('diproses');
    await expect.element(table).toMatchTextContent('dinilai harga modal');
    await expect.element(table).toMatchTextContent('—');
    await screen.getByRole('button', { name: 'Platform', exact: true }).click();
    // A platform group has no class tag, no platform column text, and shows its realized gain.
    await screen.getByRole('button', { name: 'Menu BBCA', exact: true }).click();
    await expect.element(screen.getByRole('menuitem', { name: 'Ubah target alokasi' })).not.toMatchTextContent('%');
    await screen.getByRole('menuitem', { name: 'Ubah target alokasi' }).click();
    expect(onAction).toHaveBeenLastCalledWith('targets', expect.objectContaining({ symbol: 'BBCA' }));
    await screen.getByRole('searchbox', { name: 'Cari ticker atau nama' }).fill('BBCA');
    await expect.element(table).toMatchTextContent('Total hasil pencarian');
  });

  it('says there is nothing yet when no position is held', async () => {
    const { screen } = await renderApp(
      <HoldingsTable
        portfolio={portfolioView({ targets: {}, assets: [], platforms: [] })}
        display="base"
        usdRate={null}
        locale="id"
        onAction={vi.fn()}
        onTopUp={vi.fn()}
        onAddAsset={vi.fn()}
      />,
    );
    await expect.element(screen.getByText('Belum ada aset yang dimiliki.')).toBeVisible();
  });
});
