// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { accountView } from '../../../test/accounts.ts';
import { renderApp } from '../../../test/render.tsx';
import { AccountLogo } from './account-logo.tsx';

describe('AccountLogo', () => {
  it('shows the type icon in the account color', async () => {
    const { screen } = await renderApp(
      <AccountLogo account={accountView({ type: 'ewallet', color: 'green' })} size="sm" />,
    );
    const tile = screen.container.querySelector('[data-color="green"]');
    expect(tile?.querySelector('svg')).not.toBeNull();
    expect(tile?.className).toContain('size-[22px]');
  });

  it('shows the uploaded logo, linked with a cache-busting version', async () => {
    const account = accountView({ logoKey: 'u/x/0192a6c4-0000-7000-8000-0000000000c1' });
    const { screen } = await renderApp(<AccountLogo account={account} size="lg" />);
    const image = screen.container.querySelector('img');
    expect(image?.getAttribute('src')).toBe(`/api/account-logo/${account.id}?v=0000000000c1`);
    expect(image?.getAttribute('alt')).toBe('');
  });
});
