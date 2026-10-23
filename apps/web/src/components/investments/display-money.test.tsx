// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { ApproxBase, DisplayMoney } from './display-money.tsx';

describe('DisplayMoney', () => {
  const display = { base: 'IDR', usdRate: null, locale: 'id' as const };
  it('shows the quote currency twin, the base amount, or dollars, and “≈ base” only in base mode', async () => {
    const { screen } = await renderApp(
      <p data-testid="amounts">
        <DisplayMoney baseMinor={13_500_000n} quoteMinor={82_569n} quoteCurrency="USD" display={display} />|
        <DisplayMoney baseMinor={5_500_000n} quoteCurrency="IDR" display={display} />|
        <DisplayMoney baseMinor={16_350n} display={{ ...display, usdRate: '16350' }} />|
        <DisplayMoney baseMinor={1n} quoteMinor={250n} quoteCurrency="USD" display={{ ...display, usdRate: '16350' }} />
        |
        <ApproxBase baseMinor={13_500_000n} currency="USD" display={display} />
        <ApproxBase baseMinor={1n} currency="IDR" display={display} />
        <ApproxBase baseMinor={1n} currency={null} display={display} />
        <ApproxBase baseMinor={1n} currency="USD" display={{ ...display, usdRate: '16350' }} />
      </p>,
    );
    await expect
      .element(screen.getByTestId('amounts'))
      .toMatchTextContent('US$825,69|Rp5.500.000|US$1,00|US$2,50|≈ Rp13.500.000');
  });
});
