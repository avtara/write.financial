// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { AssetLogo } from './asset-logo.tsx';

describe('AssetLogo', () => {
  it('uses a persisted listing identity rather than guessing from a ticker, and falls back for missing marks', async () => {
    const { screen } = await renderApp(
      <>
        <AssetLogo asset={{ symbol: 'BBCA', catalogId: null }} />
        <AssetLogo asset={{ symbol: 'CUSTOM', catalogId: 'stock:xidx:bbca' }} />
        <AssetLogo asset={{ symbol: 'AAPL', catalogId: 'stock:xnas:aapl' }} />
      </>,
    );
    expect(screen.container.querySelector('img')?.getAttribute('src')).toBe('/catalog-logos/bca.svg');
    await expect.element(screen.getByText('BBCA', { exact: true })).toBeVisible();
    await expect.element(screen.getByText('AAPL', { exact: true })).toBeVisible();
    expect(screen.container.querySelector('img')?.getAttribute('alt')).toBe('');
  });
});
