// SPDX-License-Identifier: AGPL-3.0-only
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { Document } from '../components/document.tsx';
import { PreferencesProvider } from '../components/preferences.tsx';
import { getPreferences } from '../server/get-preferences.ts';
import appCss from '../styles.css?url';

export const Route = createRootRoute({
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
});

function RootComponent() {
  return (
    <PreferencesProvider initial={Route.useLoaderData()}>
      <Document>
        <Outlet />
      </Document>
    </PreferencesProvider>
  );
}
