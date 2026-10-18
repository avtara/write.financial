// SPDX-License-Identifier: AGPL-3.0-only
import { createRootRoute, Outlet, redirect } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import type { Locale } from '@wf/i18n/locale';
import { Document } from '../components/document.tsx';
import { NotFoundPage } from '../components/not-found-page.tsx';
import { PreferencesProvider } from '../components/preferences.tsx';
import { saveLocale } from '../server/fn/account.ts';
import { getGate } from '../server/fn/gate.ts';
import { getPreferences } from '../server/get-preferences.ts';
import appCss from '../styles.css?url';

/** FR-S8: a signed-in user's language switch is saved to the account (and so follows them to other devices). */
const syncLocale = (locale: Locale) => {
  void saveLocale({ data: { locale } });
};

export const Route = createRootRoute({
  // Every navigation: who is signed in, and whether the instance is set up (FR-OP1: until an admin exists, every
  // page leads to the setup wizard).
  beforeLoad: async ({ location }) => {
    const gate = await getGate();
    if (gate.setup === 'pending' && location.pathname !== '/setup') throw redirect({ to: '/setup' });
    return { gate };
  },
  // Resolved once per document on the server; afterwards the client owns the preferences.
  loader: () => getPreferences(),
  staleTime: Infinity,
  shouldReload: false,
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: m.app_name() },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundPage,
});

function RootComponent() {
  const { gate } = Route.useRouteContext();
  return (
    <PreferencesProvider
      initial={Route.useLoaderData()}
      {...(gate.viewer === null ? {} : { onLocaleChange: syncLocale })}
    >
      <Document>
        <Outlet />
      </Document>
    </PreferencesProvider>
  );
}
