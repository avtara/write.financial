// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Renders the real `/_auth` layout and the given signed-out page routes in a memory router, under a root that
 * provides `context.gate` like `routes/__root.tsx`, the preferences, and fake Better Auth actions. `/` and
 * `/settings` exist as plain pages so redirects have somewhere to land.
 */
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  type AnyRoute,
} from '@tanstack/react-router';
import { setLocale } from '@wf/i18n/runtime';
import { render } from 'vitest-browser-react';
import '../src/styles.css';
import { AuthActionsProvider } from '../src/components/auth-actions.tsx';
import { PreferencesProvider } from '../src/components/preferences.tsx';
import type { AuthActions } from '../src/lib/auth-client.ts';
import type { Preferences } from '../src/lib/preferences.ts';
import { Route as AuthRoute } from '../src/routes/_auth.tsx';
import type { Gate } from '../src/server/gate.ts';
import { fakeAuthActions, fakeGate } from './fake-auth.ts';
import { DEFAULT_PREFERENCES } from './render.tsx';

export interface RenderAuthRoutesOptions {
  /** Initial URL. */
  path: string;
  gate?: Gate;
  actions?: AuthActions;
  preferences?: Partial<Preferences>;
}

/** `pages`: the page routes under `/_auth`, as `[route, path]` (e.g. `[SignInRoute, '/sign-in']`). */
export async function renderAuthRoutes(
  pages: readonly (readonly [AnyRoute, string])[],
  { path, gate = fakeGate(), actions = fakeAuthActions(), preferences = {} }: RenderAuthRoutesOptions,
) {
  const initial = { ...DEFAULT_PREFERENCES, ...preferences };
  await setLocale(initial.locale, { reload: false });
  const root = createRootRouteWithContext<object>()({
    beforeLoad: () => ({ gate }),
    component: () => (
      <PreferencesProvider initial={initial}>
        <AuthActionsProvider actions={actions}>
          <Outlet />
        </AuthActionsProvider>
      </PreferencesProvider>
    ),
  });
  const layout = AuthRoute.update({ id: '/_auth', getParentRoute: () => root } as never);
  const children = pages.map(([route, pagePath]) =>
    route.update({ id: pagePath, path: pagePath, getParentRoute: () => layout } as never),
  );
  const routeTree = root.addChildren([
    layout.addChildren(children),
    createRoute({ getParentRoute: () => root, path: '/' }),
    createRoute({ getParentRoute: () => root, path: '/settings' }),
  ]);
  const router = createRouter({ routeTree, context: {}, history: createMemoryHistory({ initialEntries: [path] }) });
  await router.load();
  const screen = await render(<RouterProvider router={router} />);
  return { screen, router };
}
