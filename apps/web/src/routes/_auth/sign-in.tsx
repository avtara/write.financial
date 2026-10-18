// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { optionalString, reauthFlag } from '../../components/auth/search.ts';
import { SignInPage } from '../../components/auth/sign-in-page.tsx';
import { revokeDevice } from '../../server/fn/account.ts';

export const Route = createFileRoute('/_auth/sign-in')({
  validateSearch: (search): { redirect?: string | undefined; reauth?: '1' | undefined } => ({
    redirect: optionalString(search.redirect),
    reauth: reauthFlag(search.reauth),
  }),
  component: function SignInRoute() {
    const { redirect, reauth } = Route.useSearch();
    const { gate } = Route.useRouteContext();
    return (
      <SignInPage
        redirect={redirect}
        reauthViewer={reauth === undefined ? null : gate.viewer}
        googleEnabled={gate.googleEnabled}
        signUpOffered={gate.registrationMode !== 'closed'}
        revokeSession={(id) => revokeDevice({ data: { id } })}
      />
    );
  },
});
