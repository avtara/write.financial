// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { manualQuote, portfolioView, SEED_ASSETS, SPY } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { InvestmentKpis } from './investment-kpis.tsx';

describe('InvestmentKpis', () => {
  it('golden: Rp61.420.000 ≈ US$3.756,57, modal Rp53.931.000, +Rp7.489.000 +13,9%, no previous close yet', async () => {
    const { screen } = await renderApp(
      <InvestmentKpis portfolio={portfolioView()} display="base" usdRate="16350" locale="id" />,
    );
    const kpis = screen.getByRole('region', { name: 'Ringkasan investasi' });
    await expect.element(kpis).toMatchTextContent(/Nilai portofolioRp61\.420\.000≈ US\$3\.756,57/);
    await expect.element(kpis).toMatchTextContent(/ModalRp53\.931\.000total yang disetor/);
    // Gains are signed and keep their currency symbol (design 09: "+Rp7.489.000").
    await expect.element(kpis).toMatchTextContent(/Untung belum terealisasi\+Rp7\.489\.000\+13,9%/);
    await expect.element(kpis).toMatchTextContent(/Hari ini—belum ada harga penutupan kemarin/);
    await expect.element(kpis).toMatchTextContent(/Dividen 12 bulanRp0bersih setelah pajak · yield 0%/);
  });

  it('puts the five KPIs in one row from 1280 px and three over two on a tablet, each amount clear of its dividers', async () => {
    const tops = async (width: number) => {
      await page.viewport(width, 900);
      const { screen } = await renderApp(
        <InvestmentKpis portfolio={portfolioView()} display="base" usdRate="16350" locale="id" />,
      );
      const cells = screen.getByRole('region', { name: 'Ringkasan investasi' }).element().children;
      const result = [...cells].map((cell) => Math.round(cell.getBoundingClientRect().top));
      // Every amount fits its cell (no overflow into the 20 px padding).
      for (const cell of cells) expect(cell.scrollWidth).toBeLessThanOrEqual(cell.clientWidth);
      await screen.unmount();
      return result;
    };
    expect(new Set(await tops(1440)).size).toBe(1);
    const tablet = await tops(1024);
    expect(tablet.slice(0, 3).every((top) => top === tablet[0])).toBe(true);
    expect(tablet[3]).toBeGreaterThan(tablet[0] as number);
    expect(tablet[4]).toBe(tablet[3]);
  });

  it('shows USD totals with the rupiah below, today’s change, and a loss in red without a rate', async () => {
    const assets = SEED_ASSETS.map((asset) =>
      asset.id === SPY.id ? { ...asset, quote: manualQuote('690.1', { prevClose: '700' }) } : asset,
    );
    const { screen } = await renderApp(
      <InvestmentKpis portfolio={portfolioView({ assets })} display="usd" usdRate="16350" locale="en" />,
      { preferences: { locale: 'en' } },
    );
    const kpis = screen.getByRole('region', { name: 'Investment summary' });
    await expect.element(kpis).toMatchTextContent(/Portfolio valueUS\$3,756\.57≈ Rp61,420,000/);
    await expect.element(kpis).toMatchTextContent(/Today−US\$11\.85−0\.3%/);
    const loss = await renderApp(
      <InvestmentKpis
        portfolio={portfolioView({ assets: [{ ...SPY, quote: manualQuote('500') }], dividends12m: 0n })}
        display="usd"
        usdRate={null}
        locale="id"
      />,
    );
    await expect.element(loss.screen.getByText(/^−Rp\d/).first()).toBeVisible();
  });

  it('leaves out chips and the yield when there is nothing to compare', async () => {
    const base = portfolioView();
    const asset = base.summary.positions.find((position) => !position.key.startsWith('cash:'));
    const portfolio = {
      ...base,
      summary: {
        ...base.summary,
        gainBps: null,
        todayBps: null,
        yieldBps: null,
        positions: asset === undefined ? base.summary.positions : [{ ...asset, todayBaseMinor: 0n }],
      },
    };
    const { screen } = await renderApp(
      <InvestmentKpis portfolio={portfolio} display="base" usdRate="16350" locale="id" />,
    );
    const kpis = screen.getByRole('region', { name: 'Ringkasan investasi' });
    await expect.element(kpis).toMatchTextContent('Hari ini+Rp0');
    await expect.element(kpis).toMatchTextContent('bersih setelah pajak');
    await expect.element(kpis).not.toMatchTextContent('yield');
    expect(kpis.getByText('%', { exact: false }).query()).toBeNull();
  });
});
