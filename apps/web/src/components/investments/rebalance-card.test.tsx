// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import type { PortfolioView } from '@wf/db/investments';
import { portfolioView } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { RebalanceCard } from './rebalance-card.tsx';

describe('RebalanceCard', () => {
  it('recomputes suggestions when fresh money is entered, without a trade action', async () => {
    const { screen } = await renderApp(
      <RebalanceCard portfolio={portfolioView()} rates={{ USD: '16350' }} locale="id" onEditTargets={vi.fn()} />,
    );
    const card = screen.getByRole('region', { name: 'Kalkulator rebalancing' });
    await screen.getByRole('textbox', { name: 'Dana tambahan' }).fill('100.000.000');
    await expect.element(card).toMatchTextContent('Beli Rp100.000.000 · jual Rp0');
  });

  it('shows a balanced cash-only portfolio and works without a dollar rate', async () => {
    const cashOnly: PortfolioView = portfolioView({
      targets: { cash: 10_000 },
      assets: [],
      platforms: [
        {
          accountId: 'p1',
          name: 'Tunai',
          currency: 'IDR',
          cashMinor: 1_000n,
          cashBaseMinor: 1_000n,
          holdingsValueBaseMinor: 0n,
          valueBaseMinor: 1_000n,
          assetCount: 0,
        },
      ],
    });
    const { screen } = await renderApp(
      <RebalanceCard portfolio={cashOnly} rates={{}} locale="id" onEditTargets={vi.fn()} />,
    );
    const card = screen.getByRole('region', { name: 'Kalkulator rebalancing' });
    await expect.element(card).toMatchTextContent('Beli Rp0 · jual Rp0');
    await expect.element(card).not.toMatchTextContent('Kurs USD');
    await screen.getByRole('textbox', { name: 'Dana tambahan' }).fill('0');
    await expect.element(card).toMatchTextContent('Beli Rp0 · jual Rp0');
    await screen.unmount();
    const noTargets = await renderApp(
      <RebalanceCard
        portfolio={portfolioView({ targets: {} })}
        rates={{ USD: '16350' }}
        locale="id"
        onEditTargets={vi.fn()}
      />,
    );
    await expect
      .element(noTargets.screen.getByRole('region', { name: 'Kalkulator rebalancing' }))
      .toMatchTextContent('Atur target alokasi untuk melihat saran rebalancing.');
    await noTargets.screen.unmount();
    const sells = await renderApp(
      <RebalanceCard
        portfolio={portfolioView({ targets: { cash: 10_000 } })}
        rates={{ USD: '16350' }}
        locale="id"
        onEditTargets={vi.fn()}
      />,
    );
    const cardWithSells = sells.screen.getByRole('region', { name: 'Kalkulator rebalancing' });
    await expect.element(cardWithSells).toMatchTextContent('Jual');
  });
});
