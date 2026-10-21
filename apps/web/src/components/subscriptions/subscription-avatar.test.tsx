// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../../test/render.tsx';
import { SubscriptionAvatar } from './subscription-avatar.tsx';

describe('SubscriptionAvatar', () => {
  it('shows the uploaded logo, else the icon, else the first letter', async () => {
    const { screen } = await renderApp(
      <>
        <SubscriptionAvatar subscription={{ id: 'a', name: 'Netflix', icon: 'tv', logoKey: 'u/x/0000000000c1' }} />
        <SubscriptionAvatar subscription={{ id: 'b', name: 'Spotify', icon: 'music', logoKey: null }} size="lg" />
        <SubscriptionAvatar subscription={{ id: 'c', name: 'vidio', icon: null, logoKey: null }} size="sm" />
        <SubscriptionAvatar subscription={{ id: 'd', name: 'Other', icon: 'unknown-glyph', logoKey: null }} />
      </>,
    );
    const root = screen.container;
    expect(root.querySelector('img')?.getAttribute('src')).toBe('/api/subscription-logo/a?v=0000000000c1');
    const tiles = [...root.querySelectorAll('span[aria-hidden="true"]')];
    expect(tiles).toHaveLength(3);
    expect(tiles[0]?.querySelector('svg')).not.toBeNull();
    expect(tiles[0]?.getAttribute('data-color')).not.toBeNull();
    expect(tiles[1]?.textContent).toBe('V');
    expect(tiles[2]?.textContent).toBe('O');
  });
});
