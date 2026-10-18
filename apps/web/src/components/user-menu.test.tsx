// SPDX-License-Identifier: AGPL-3.0-only
import { getLocale } from '@wf/i18n/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { fakeAuthActions, VIEWER } from '../../test/fake-auth.ts';
import { renderApp, type RenderAppOptions } from '../../test/render.tsx';
import { AuthActionsProvider } from './auth-actions.tsx';
import { usePreferences } from './preferences.tsx';
import { initials, UserMenu } from './user-menu.tsx';

const server = vi.hoisted(() => ({
  listDevices: vi.fn(() => Promise.resolve({ ok: true, value: [] })),
  revokeOtherDevices: vi.fn(),
}));
vi.mock('../server/fn/account.ts', () => server);

function State() {
  const { preferences } = usePreferences();
  return <output data-testid="state">{JSON.stringify(preferences)}</output>;
}

async function openMenu(variant: 'sidebar' | 'rail', options: RenderAppOptions = {}, viewer?: typeof VIEWER) {
  const result = await renderApp(
    <AuthActionsProvider actions={fakeAuthActions()}>
      <UserMenu variant={variant} viewer={viewer} />
      <State />
    </AuthActionsProvider>,
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

  it('shows the signed-in user with initials, name, and email', async () => {
    const { screen, menu } = await openMenu('sidebar', {}, VIEWER);
    await expect
      .element(screen.getByRole('button', { name: 'Menu pengguna' }))
      .toHaveTextContent(`AK${VIEWER.name}${VIEWER.email}`);
    expect(menu.element().textContent).toMatch(new RegExp(`^AK${VIEWER.name}`));
    await expect.element(menu.getByRole('menuitem', { name: /^Pengaturan/ })).toHaveTextContent('Pengaturan⌘,');
  });

  it('opens Settings › Profile from the menu and with ⌘ ,', async () => {
    const { menu, router } = await openMenu('rail', {}, VIEWER);
    await userEvent.click(menu.getByRole('menuitem', { name: /^Pengaturan/ }));
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/settings/profile');
    });
    await router.navigate({ to: '/' });
    await userEvent.keyboard('{Meta>},{/Meta}');
    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/settings/profile');
    });
  });

  it('asks before signing out', async () => {
    const { menu } = await openMenu('sidebar', {}, VIEWER);
    await userEvent.click(menu.getByRole('menuitem', { name: 'Keluar' }));
    const dialog = page.getByRole('alertdialog', { name: 'Keluar dari write.financial?' });
    await expect.element(dialog).toBeVisible();
    await userEvent.click(dialog.getByRole('button', { name: 'Batal' }));
    await expect.element(dialog).not.toBeInTheDocument();
  });
});

describe('initials', () => {
  it('takes the first letters of the first two words, else the email', () => {
    expect(initials({ name: 'avtara  kusuma wijaya', email: 'a@example.test' })).toBe('AK');
    expect(initials({ name: 'Avtara', email: 'a@example.test' })).toBe('A');
    expect(initials({ name: '', email: 'budi@example.test' })).toBe('B');
  });
});
