// SPDX-License-Identifier: AGPL-3.0-only
import { getLocale } from '@wf/i18n/runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../../test/render.tsx';
import { usePreferences } from './preferences.tsx';
import { UserMenu } from './user-menu.tsx';

function State() {
  const { preferences } = usePreferences();
  return <output data-testid="state">{JSON.stringify(preferences)}</output>;
}

async function openMenu(variant: 'sidebar' | 'rail', options: Parameters<typeof renderApp>[1] = {}) {
  const result = await renderApp(
    <>
      <UserMenu variant={variant} />
      <State />
    </>,
    options,
  );
  await userEvent.click(result.screen.getByRole('button', { name: /^(Menu pengguna|User menu)$/ }));
  const menu = page.getByRole('menu');
  await expect.element(menu).toBeVisible();
  const state = () => JSON.parse(result.screen.getByTestId('state').element().textContent) as Record<string, unknown>;
  return { ...result, menu, state };
}

beforeEach(async () => {
  await page.viewport(1440, 900);
});

describe('UserMenu', () => {
  it('shows the guest in the sidebar trigger and the menu header', async () => {
    const { screen, menu } = await openMenu('sidebar');
    await expect.element(screen.getByRole('button', { name: 'Menu pengguna' })).toHaveTextContent('TamuBelum masuk');
    expect(menu.element().textContent).toMatch(/^TamuBelum masuk/);
  });

  it('marks the current theme and language and switches them', async () => {
    const { menu, state } = await openMenu('sidebar');
    await expect.element(menu.getByRole('menuitemradio', { name: 'Gelap' })).toHaveAttribute('aria-checked', 'true');
    await expect
      .element(menu.getByRole('menuitemradio', { name: 'Bahasa Indonesia' }))
      .toHaveAttribute('aria-checked', 'true');
    await userEvent.click(menu.getByRole('menuitemradio', { name: 'Terang' }));
    expect(state().theme).toBe('light');
    await expect.element(page.getByRole('menu')).not.toBeInTheDocument();
  });

  it('switches the language', async () => {
    const { menu, state } = await openMenu('sidebar');
    await userEvent.click(menu.getByRole('menuitemradio', { name: 'English' }));
    expect(state().locale).toBe('en');
    expect(getLocale()).toBe('en');
  });

  it('toggles privacy mode and stays open so the switch visibly flips', async () => {
    const { menu, state } = await openMenu('rail', { preferences: { locale: 'en' } });
    const hide = menu.getByRole('menuitemcheckbox', { name: 'Hide balances' });
    await expect.element(hide).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(hide);
    await expect.element(hide).toHaveAttribute('aria-checked', 'true');
    expect(state().balancesHidden).toBe(true);
    await userEvent.click(hide);
    expect(state().balancesHidden).toBe(false);
  });

  it('opens to the right of the rail avatar', async () => {
    const { screen, menu } = await openMenu('rail');
    const trigger = screen.getByRole('button', { name: 'Menu pengguna' }).element().getBoundingClientRect();
    expect(menu.element().getBoundingClientRect().left).toBeGreaterThanOrEqual(trigger.right);
    await expect.element(menu.getByRole('menuitemradio', { name: 'Sistem' })).toBeVisible();
  });
});
