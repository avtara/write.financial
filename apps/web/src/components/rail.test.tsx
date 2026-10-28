// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../../test/render.tsx';
import type { NavCounts } from './nav.ts';
import { AssistantProvider } from './assistant/assistant.tsx';
import { CommandPaletteProvider } from './command-palette/command-palette.tsx';
import { Rail } from './rail.tsx';

const app = vi.hoisted(() => ({
  viewer: undefined as object | undefined,
  counts: null as NavCounts | null,
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useRouteContext: () => ({ viewer: app.viewer }),
}));
vi.mock('./sidebar.tsx', () => ({ useNavCounts: () => app.counts }));
vi.mock('./notifications/notification-bell.tsx', () => ({
  NotificationBell: (props: { unread: number | null }) => (
    <span data-testid="bell" data-unread={String(props.unread)} />
  ),
}));
vi.mock('../server/fn/search.ts', () => ({
  listRecent: () => Promise.resolve({ ok: true, value: [] }),
  searchEverything: vi.fn(),
  touchRecent: vi.fn(),
}));
// The Assistant sheet is tested on its own; here it only shows that the rail opened it.
vi.mock('./assistant/assistant-dialog.tsx', () => ({
  AssistantDialog: ({ open }: { readonly open: boolean }) => (open ? <div role="dialog" aria-label="Asisten" /> : null),
}));

const rail = (
  <AssistantProvider timeZone="Asia/Jakarta">
    <CommandPaletteProvider>
      <Rail />
    </CommandPaletteProvider>
  </AssistantProvider>
);

beforeEach(async () => {
  await page.viewport(1024, 768);
});

describe('Rail', () => {
  it('has the bell for a signed-in user next to search, before the navigation, with the unread count when known', async () => {
    app.viewer = { name: 'Avtara K.', email: 'avtara@example.test', image: null, timezone: 'Asia/Jakarta' };
    app.counts = { transactions: 1, review: 0, subscriptions: 0, notifications: 5 };
    const { screen } = await renderApp(rail);
    await expect.element(screen.getByTestId('bell')).toHaveAttribute('data-unread', '5');
    // Section 19 order: search, bell, navigation, …, Assistant at the bottom.
    const [search, bell, nav, assistant] = [
      screen.getByRole('button', { name: 'Cari' }),
      screen.getByTestId('bell'),
      screen.getByRole('navigation'),
      screen.getByRole('button', { name: 'Tanya Asisten' }),
    ].map((locator) => locator.element());
    expect(search?.nextElementSibling).toBe(bell);
    expect(bell?.compareDocumentPosition(nav as Element)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(nav?.compareDocumentPosition(assistant as Element)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await screen.unmount();
    app.counts = null;
    const unknown = await renderApp(rail);
    await expect.element(unknown.screen.getByTestId('bell')).toHaveAttribute('data-unread', 'null');
    await unknown.screen.unmount();
    app.viewer = undefined;
  });

  it('is a 64 px icon rail between 768 and 1279 px', async () => {
    const { screen } = await renderApp(rail);
    const aside = screen.getByRole('complementary');
    await expect.element(aside).toBeVisible();
    expect(aside.element().getBoundingClientRect().width).toBe(64);
    const link = screen.getByRole('link', { name: 'Ringkasan' });
    await expect.element(link).toHaveTextContent('');
    await expect.element(link).toHaveAttribute('data-status', 'active');
    expect(link.element().getBoundingClientRect().height).toBe(40);
    const avatar = screen.getByRole('button', { name: 'Menu pengguna' });
    await expect.element(avatar).toBeVisible();
    expect(avatar.element().getBoundingClientRect().height).toBe(40);
  });

  it('lists the pages in the sidebar’s groups, named for screen readers, and keeps an entry active whatever its search params', async () => {
    const { screen } = await renderApp(rail, { path: '/?period=2026-10' });
    const nav = screen.getByRole('navigation', { name: 'Navigasi utama' });
    const groups = nav.getByRole('list').elements();
    expect(groups.map((list) => [list.getAttribute('aria-label'), list.querySelectorAll('a').length])).toEqual([
      ['Utama', 4],
      ['Rencana', 3],
      ['Aset & utang', 4],
    ]);
    await expect.element(screen.getByRole('link', { name: 'Ringkasan' })).toHaveAttribute('data-status', 'active');
    await expect.element(screen.getByRole('link', { name: 'Transaksi' })).toHaveAttribute('href', '/transactions');
  });

  it('names each icon in a tooltip on hover', async () => {
    const { screen } = await renderApp(rail);
    await expect.element(page.getByRole('tooltip')).not.toBeInTheDocument();
    await userEvent.hover(screen.getByRole('link', { name: 'Ringkasan' }));
    await expect.element(page.getByRole('tooltip')).toHaveTextContent('Ringkasan');
  });

  it('names each icon in a tooltip on keyboard focus', async () => {
    const { screen } = await renderApp(rail);
    await userEvent.tab();
    await expect.element(screen.getByRole('button', { name: 'Cari' })).toHaveFocus();
    await userEvent.tab();
    await expect.element(screen.getByRole('link', { name: 'Ringkasan' })).toHaveFocus();
    await expect.element(page.getByRole('tooltip')).toHaveTextContent('Ringkasan');
  });

  it('is hidden on desktop and on phones', async () => {
    for (const width of [1280, 767]) {
      await page.viewport(width, 800);
      const { screen } = await renderApp(rail);
      await expect.element(screen.getByRole('complementary', { includeHidden: true })).not.toBeVisible();
      await screen.unmount();
    }
  });

  it('opens the command palette from its search button', async () => {
    const { screen } = await renderApp(rail);
    const search = screen.getByRole('button', { name: 'Cari' });
    await expect.element(search).toHaveAttribute('aria-keyshortcuts', 'Meta+K');
    expect(search.element().getBoundingClientRect().height).toBe(40);
    await userEvent.hover(search);
    await expect.element(page.getByRole('tooltip')).toHaveTextContent('Cari⌘K');
    await userEvent.click(search);
    await expect.element(page.getByRole('dialog', { name: 'Cari atau jalankan perintah' })).toBeVisible();
  });

  it('opens the Assistant from its 40 px button, naming ⌘J', async () => {
    const { screen } = await renderApp(rail);
    const ask = screen.getByRole('button', { name: 'Tanya Asisten' });
    await expect.element(ask).toHaveAttribute('aria-keyshortcuts', 'Meta+J');
    expect(ask.element().getBoundingClientRect().height).toBe(40);
    await userEvent.hover(ask);
    await expect.element(page.getByRole('tooltip')).toHaveTextContent('Tanya Asisten⌘J');
    await userEvent.click(ask);
    await expect.element(page.getByRole('dialog', { name: 'Asisten' })).toBeInTheDocument();
  });

  it('names the Ctrl+K shortcut on other platforms', async () => {
    const { screen } = await renderApp(rail, { preferences: { platform: 'other' } });
    await expect
      .element(screen.getByRole('button', { name: 'Cari' }))
      .toHaveAttribute('aria-keyshortcuts', 'Control+K');
  });
});
