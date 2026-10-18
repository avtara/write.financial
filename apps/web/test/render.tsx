// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Browser-test harness: renders UI inside a memory router (so `<Link>` and `useNavigate` work) with the
 * app's preference and shortcut providers, and puts the Paraglide runtime on the same locale.
 */
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { setLocale } from '@wf/i18n/runtime';
import type { ReactNode } from 'react';
import { render } from 'vitest-browser-react';
import '../src/styles.css';
import { PreferencesProvider } from '../src/components/preferences.tsx';
import { ShortcutProvider } from '../src/components/shortcuts.tsx';
import type { Preferences } from '../src/lib/preferences.ts';

/**
 * Lets React render after fake timers fired a state update. React schedules its work through
 * `MessageChannel`, which fake timers leave real, so a few message hops flush render, commit, and effects.
 */
export async function flushReact(): Promise<void> {
  for (let hop = 0; hop < 3; hop++) {
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }
}

export const DEFAULT_PREFERENCES: Preferences = {
  locale: 'id',
  theme: 'dark',
  balancesHidden: false,
  platform: 'mac',
};

export interface RenderAppOptions {
  preferences?: Partial<Preferences>;
  /** Initial URL; `/` and `/other` exist. */
  path?: string;
}

export async function renderApp(ui: ReactNode, { preferences = {}, path = '/' }: RenderAppOptions = {}) {
  const initial = { ...DEFAULT_PREFERENCES, ...preferences };
  await setLocale(initial.locale, { reload: false });
  const root = createRootRoute({
    component: () => (
      <PreferencesProvider initial={initial}>
        <ShortcutProvider platform={initial.platform}>
          {ui}
          <Outlet />
        </ShortcutProvider>
      </PreferencesProvider>
    ),
  });
  const routeTree = root.addChildren([
    createRoute({ getParentRoute: () => root, path: '/' }),
    createRoute({ getParentRoute: () => root, path: '/other' }),
  ]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  await router.load();
  const screen = await render(<RouterProvider router={router} />);
  return { screen, router };
}
