// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { ApproxBalance } from './approx-balance.tsx';

describe('ApproxBalance', () => {
  it('shows a foreign balance in the base currency at the current rate', async () => {
    const { screen } = await renderApp(
      <ApproxBalance account={{ currency: 'USD', balanceBaseMinor: 45_420_300n }} baseCurrency="IDR" />,
    );
    await expect.element(screen.getByText('≈ Rp45.420.300')).toBeVisible();
  });

  it('masks the amount in privacy mode', async () => {
    const { screen } = await renderApp(
      <ApproxBalance account={{ currency: 'USD', balanceBaseMinor: 45_420_300n }} baseCurrency="IDR" />,
      { preferences: { balancesHidden: true } },
    );
    await expect.element(screen.getByText(/^≈ /)).toBeVisible();
    expect(screen.container.textContent).not.toContain('45.420.300');
  });

  it('shows nothing in the base currency or without a rate', async () => {
    for (const account of [
      { currency: 'IDR', balanceBaseMinor: 1_000n },
      { currency: 'USD', balanceBaseMinor: null },
    ]) {
      const { screen } = await renderApp(<ApproxBalance account={account} baseCurrency="IDR" />);
      expect(screen.container.textContent).toBe('');
      await screen.unmount();
    }
  });
});
