// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { optionalString } from '../../components/auth/search.ts';
import { SignUpPage } from '../../components/auth/sign-up-page.tsx';

export const Route = createFileRoute('/_auth/sign-up')({
  validateSearch: (search): { invitation?: string | undefined } => ({ invitation: optionalString(search.invitation) }),
  component: function SignUpRoute() {
    const { invitation } = Route.useSearch();
    const { gate } = Route.useRouteContext();
    return (
      <SignUpPage invitation={invitation} registrationMode={gate.registrationMode} googleEnabled={gate.googleEnabled} />
    );
  },
});
