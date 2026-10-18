// SPDX-License-Identifier: AGPL-3.0-only
import { createContext, use, type ReactNode } from 'react';
import { createAuthActions, type AuthActions } from '../lib/auth-client.ts';

const AuthActionsContext = createContext<AuthActions | null>(null);

let browserActions: AuthActions | undefined;

/** Overrides the Better Auth actions below it (component tests pass fakes). */
export function AuthActionsProvider({ actions, children }: { actions: AuthActions; children: ReactNode }) {
  return <AuthActionsContext value={actions}>{children}</AuthActionsContext>;
}

/** The auth actions of the nearest provider, else the browser's own client (created on first use). */
export function useAuthActions(): AuthActions {
  const provided = use(AuthActionsContext);
  return provided ?? (browserActions ??= createAuthActions());
}
