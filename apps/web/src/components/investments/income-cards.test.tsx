// SPDX-License-Identifier: AGPL-3.0-only
import type { PortfolioView } from '@wf/db/investments';
import type { YearMonth } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { BBCA, portfolioView, SCHD, SPY } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { DividendsCard, PlatformsCard } from './income-cards.tsx';

describe('investment income and platforms', () => {
  it('reports zero recorded dividends rather than design-only yield, and includes platform cash', async () => {
    const portfolio = portfolioView();
    const { screen } = await renderApp(
      <>
        <DividendsCard portfolio={portfolio} locale="id" />
        <PlatformsCard portfolio={portfolio} locale="id" />
      </>,
    );
    await expect.element(screen.getByRole('region', { name: /Dividen/ })).toMatchTextContent('Rp0');
    await expect.element(screen.getByRole('region', { name: 'Platform' })).toMatchTextContent('Rp45.420.000');
  });

  it('draws paid dividends in bars, lists payers by size, and flags a concentrated platform', async () => {
    const base = portfolioView();
    const portfolio: PortfolioView = {
      ...base,
      summary: { ...base.summary, valueBaseMinor: 1_000n, positions: [] },
      dividends: {
        totalMinor: 1_000_000n,
        months: [
          { month: '2026-09' as YearMonth, minor: 0n },
          { month: '2026-10' as YearMonth, minor: 1_000_000n },
        ],
      },
      assets: [
        { ...SPY, holding: { ...SPY.holding, dividendBaseMinor: 100n } },
        { ...BBCA, holding: { ...BBCA.holding, dividendBaseMinor: 50n } },
        { ...SCHD, holding: { ...SCHD.holding, dividendBaseMinor: 200n } },
      ],
      platforms: [
        {
          accountId: 'p1',
          name: 'Gotrade',
          currency: 'USD',
          cashMinor: 500n,
          cashBaseMinor: 500n,
          holdingsValueBaseMinor: 400n,
          valueBaseMinor: 900n,
          assetCount: 2,
        },
        {
          accountId: 'p2',
          name: 'Stockbit',
          currency: 'IDR',
          cashMinor: 0n,
          cashBaseMinor: 0n,
          holdingsValueBaseMinor: 100n,
          valueBaseMinor: 100n,
          assetCount: 0,
        },
        {
          accountId: 'p3',
          name: 'Tanpa kurs',
          currency: 'USD',
          cashMinor: 0n,
          cashBaseMinor: null,
          holdingsValueBaseMinor: 0n,
          valueBaseMinor: null,
          assetCount: 0,
        },
      ],
    };
    const { screen } = await renderApp(
      <>
        <DividendsCard portfolio={portfolio} locale="id" />
        <PlatformsCard portfolio={portfolio} locale="id" />
      </>,
    );
    await expect.element(screen.getByRole('region', { name: /Dividen/ })).toMatchTextContent('Rp1.000.000');
    await expect.element(screen.getByRole('region', { name: /Dividen/ })).toMatchTextContent('SPY');
    await expect.element(screen.getByRole('region', { name: /Dividen/ })).toMatchTextContent('BBCA');
    const platforms = screen.getByRole('region', { name: 'Platform' });
    await expect.element(platforms).toMatchTextContent('90%');
    await expect.element(platforms).toMatchTextContent('—');
    await expect.element(platforms).toMatchTextContent('90% aset ada di Gotrade');
    await screen.unmount();
    const unknown = await renderApp(
      <PlatformsCard
        portfolio={{ ...portfolio, platforms: [portfolio.platforms[2] as (typeof portfolio.platforms)[number]] }}
        locale="id"
      />,
    );
    await expect.element(unknown.screen.getByRole('region', { name: 'Platform' })).toMatchTextContent('—');
    await expect
      .element(unknown.screen.getByRole('region', { name: 'Platform' }))
      .not.toMatchTextContent('Pertimbangkan perlindungan');
  });
});
