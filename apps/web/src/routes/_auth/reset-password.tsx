// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { ResetPasswordPage } from '../../components/auth/reset-password-page.tsx';
import { optionalString } from '../../components/auth/search.ts';

export const Route = createFileRoute('/_auth/reset-password')({
  validateSearch: (search): { token?: string | undefined; error?: string | undefined } => ({
    token: optionalString(search.token),
    error: optionalString(search.error),
  }),
  component: function ResetPasswordRoute() {
    const { token, error } = Route.useSearch();
    return <ResetPasswordPage token={token} error={error} />;
  },
});
