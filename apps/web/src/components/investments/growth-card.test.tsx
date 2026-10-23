// SPDX-License-Identifier: AGPL-3.0-only
import type { YearMonth } from '@wf/domain/period';
import { describe, expect, it } from 'vitest';
import { benchmarks, investmentsOverview } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { GrowthCard } from './growth-card.tsx';
import { growthPoints } from './investments-model.ts';

describe('GrowthCard', () => {
  it('does not label a partial-year return as YTD or invent missing benchmarks', async () => {
    const overview = investmentsOverview();
    const points = growthPoints(overview.snapshots, {month: '2026-10' as YearMonth, valueMinor: 61_420_000n, costMinor: 53_931_000n});
    const {screen} = await renderApp(<GrowthCard points={points} benchmarks={benchmarks(null,null)} currency="IDR" convert={(value)=>value} locale="id" />);
    const card=screen.getByRole('region',{name:'Pertumbuhan portofolio'});
    await expect.element(card).toHaveTextContent('Portofolio—SPY—IHSG—');
    await screen.getByRole('button',{name:'1B',exact:true}).click();
    await expect.element(screen.getByRole('button',{name:'1B',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect.element(card.getByRole('img').first()).toHaveAccessibleName(/September 2026/);
  });
  it('labels USD chart values in dollars rather than millions of cents', async () => {
    const {screen} = await renderApp(<GrowthCard points={[{
      month: '2026-10' as YearMonth, valueMinor: 375_657n, costMinor: 329_853n, contributionsMinor: 0n,
    }]} benchmarks={benchmarks(null, null)} currency="USD" convert={(value) => value} locale="id" />);
    await expect.element(screen.getByRole('img')).toHaveAccessibleName('Oktober 2026: USD 3.756,6');
  });
});
