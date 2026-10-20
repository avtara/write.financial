// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { Amount, BudgetFormatProvider, Pct } from './budget-format.tsx';

describe('budget formats', () => {
  it('formats in rupiah and Indonesian without a provider', async () => {
    const { screen } = await renderApp(
      <p>
        <Amount valueMinor={3_500_000n} /> | <Amount valueMinor={3_500_000n} bare className="text-subtle" /> |{' '}
        <Pct bps={8800} /> | <Pct bps={null} className="text-red-fg" />
      </p>,
    );
    await expect.element(screen.getByText('Rp3.500.000')).toBeVisible();
    await expect.element(screen.getByText('3.500.000', { exact: true })).toHaveClass('!inline', 'text-subtle');
    await expect.element(screen.getByText('88%')).toBeVisible();
    await expect.element(screen.getByText('—')).toHaveClass('text-red-fg');
  });

  it('takes the currency and locale from the provider', async () => {
    const { screen } = await renderApp(
      <BudgetFormatProvider value={{ currency: 'USD', locale: 'en' }}>
        <p>
          <Amount valueMinor={5200n} /> | <Pct bps={4839} className="text-fg" />
        </p>
      </BudgetFormatProvider>,
    );
    await expect.element(screen.getByText('US$52.00')).toBeVisible();
    await expect.element(screen.getByText('48%')).toHaveClass('text-fg');
  });
});
