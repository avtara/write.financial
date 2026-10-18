// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute, useRouterState } from '@tanstack/react-router';
import { optionalString } from '../../components/auth/search.ts';
import { TwoFactorPage } from '../../components/auth/two-factor-page.tsx';
import { revokeDevice } from '../../server/fn/account.ts';

export const Route = createFileRoute('/_auth/2fa')({
  validateSearch: (search): { redirect?: string | undefined; previous?: string | undefined } => ({
    redirect: optionalString(search.redirect),
    previous: optionalString(search.previous),
  }),
  component: function TwoFactorRoute() {
    const { redirect, previous } = Route.useSearch();
    // The sign-in page passes the email in the history entry, so it never appears in the address bar.
    const email = useRouterState({
      select: ({ location: { state } }) => ('email' in state ? optionalString(state.email) : undefined),
    });
    return (
      <TwoFactorPage
        redirect={redirect}
        previous={previous}
        email={email}
        revokeSession={(id) => revokeDevice({ data: { id } })}
      />
    );
  },
});
