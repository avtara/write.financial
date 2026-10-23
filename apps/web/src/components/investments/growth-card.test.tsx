// SPDX-License-Identifier: AGPL-3.0-only
import type { YearMonth } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { benchmarks, investmentsOverview } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { GrowthCard } from './growth-card.tsx';
import { growthPoints } from './investments-model.ts';

describe('GrowthCard', () => {
  it('does not label a partial-year return as YTD or invent missing benchmarks', async () => {
    const overview = investmentsOverview();
    const points = growthPoints(overview.snapshots, {
      month: '2026-10' as YearMonth,
      valueMinor: 61_420_000n,
      costMinor: 53_931_000n,
    });
    const { screen } = await renderApp(
      <GrowthCard
        points={points}
        benchmarks={benchmarks(null, null)}
        currency="IDR"
        convert={(value) => value}
        locale="id"
      />,
    );
    const card = screen.getByRole('region', { name: 'Pertumbuhan portofolio' });
    await expect.element(card).toMatchTextContent('Portofolio—SPY—IHSG—');
    await screen.getByRole('button', { name: '1B', exact: true }).click();
    await expect
      .element(screen.getByRole('button', { name: '1B', exact: true }))
      .toHaveAttribute('aria-pressed', 'true');
    await expect.element(card.getByRole('img').first()).toHaveAccessibleName(/September 2026/);
  });
  it('labels USD chart values in dollars rather than millions of cents', async () => {
    const { screen } = await renderApp(
      <GrowthCard
        points={[
          {
            month: '2026-10' as YearMonth,
            valueMinor: 375_657n,
            costMinor: 329_853n,
            contributionsMinor: 0n,
          },
        ]}
        benchmarks={benchmarks(null, null)}
        currency="USD"
        convert={(value) => value}
        locale="id"
      />,
    );
    await expect.element(screen.getByRole('img')).toHaveAccessibleName('Oktober 2026: USD 3.756,6');
  });

  it('shows the tooltip on hover and focus, from last year’s baseline to a negative month', async () => {
    const points = [
      {
        month: '2025-12' as YearMonth,
        valueMinor: 100n,
        costMinor: 120n,
        contributionsMinor: 0n,
        gainMinor: -20n,
        gainBps: null,
        changeMinor: null,
        changeBps: null,
      },
      {
        month: '2026-09' as YearMonth,
        valueMinor: 0n,
        costMinor: 150n,
        contributionsMinor: 10n,
        gainMinor: -150n,
        gainBps: -10_000,
        changeMinor: -100n,
        changeBps: -10_000,
      },
      {
        month: '2026-10' as YearMonth,
        valueMinor: -5n,
        costMinor: 0n,
        contributionsMinor: 0n,
        gainMinor: -5n,
        gainBps: null,
        changeMinor: -205n,
        changeBps: null,
      },
    ];
    const { screen } = await renderApp(
      <GrowthCard
        points={points}
        benchmarks={benchmarks(310, -500)}
        currency="IDR"
        convert={(value) => value}
        locale="id"
      />,
    );
    await page.viewport(1440, 1000);
    const card = screen.getByRole('region', { name: 'Pertumbuhan portofolio' });
    await expect.element(card).toMatchTextContent('Portofolio');
    await expect.element(card).toMatchTextContent('SPY');
    await expect.element(card).toMatchTextContent('IHSG');
    const bars = card.getByRole('img');
    await expect.element(bars.first()).toBeInTheDocument();
    await userEvent.hover(bars.first().element());
    await expect.element(card.getByRole('tooltip')).toMatchTextContent('Akhir Desember 2025');
    await userEvent.unhover(bars.first().element());
    await userEvent.hover(bars.nth(1).element());
    await expect.element(card.getByRole('tooltip')).toMatchTextContent('vs Desember');
    await userEvent.unhover(bars.nth(1).element());
    bars.nth(2).element().focus();
    await expect.element(card.getByRole('tooltip')).toMatchTextContent('Akhir Oktober 2026');
    await expect.element(card.getByRole('tooltip')).not.toMatchTextContent('(');
    bars.first().element().focus();
    await expect.element(card.getByRole('tooltip')).not.toMatchTextContent('vs ');
    await screen.unmount();
  });

  it('hides the bar values in privacy mode and draws nothing without points', async () => {
    const points = [
      {
        month: '2026-10' as YearMonth,
        valueMinor: 375_657n,
        costMinor: 329_853n,
        contributionsMinor: 0n,
        gainMinor: 45_804n,
        gainBps: 1388,
        changeMinor: null,
        changeBps: null,
      },
    ];
    const { screen } = await renderApp(
      <GrowthCard points={points} benchmarks={benchmarks(null, null)} currency="IDR" convert={(v) => v} locale="id" />,
      { preferences: { balancesHidden: true } },
    );
    const card = screen.getByRole('region', { name: 'Pertumbuhan portofolio' });
    await expect.element(card.getByRole('img').first()).toHaveAccessibleName(/•••/);
    await screen.unmount();
    const empty = await renderApp(
      <GrowthCard points={[]} benchmarks={benchmarks(null, null)} currency="IDR" convert={(v) => v} locale="id" />,
    );
    await expect.element(empty.screen.getByRole('region', { name: 'Pertumbuhan portofolio' })).toBeVisible();
    await empty.screen.getByRole('button', { name: 'Semua', exact: true }).click();
  });
});
