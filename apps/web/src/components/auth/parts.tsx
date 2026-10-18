// SPDX-License-Identifier: AGPL-3.0-only
/** Pieces the sign-in and sign-up pages share (design `GNOjT`, `zPHkt`). */
import { m } from '@wf/i18n/messages';
import { useState, type ReactNode } from 'react';
import type { AuthFailure } from '../../lib/auth-client.ts';
import { authErrorMessage } from '../../lib/auth-errors.ts';
import { useAuthActions } from '../auth-actions.tsx';
import { Button, FormError } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';

/** The Google logo (brand colors), drawn so it needs no image request. */
function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18" className="size-4">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92a8.78 8.78 0 0 0 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/**
 * "Lanjut dengan Google" and the "atau" divider below it. Leaves for Google, which comes back to `callbackURL`;
 * shows the reason when that could not start.
 */
export function GoogleSignIn({ callbackURL }: { callbackURL: string }) {
  const actions = useAuthActions();
  const { preferences } = usePreferences();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AuthFailure | null>(null);
  const start = async () => {
    setPending(true);
    setError(null);
    const result = await actions.signInGoogle(callbackURL);
    if (!result.ok) {
      setError(result.error);
      setPending(false);
    }
  };
  return (
    <div className="flex flex-col gap-[18px]">
      <Button variant="secondary" pending={pending} onClick={() => void start()}>
        <GoogleMark />
        {m.auth_page_google()}
      </Button>
      {error === null ? null : <FormError>{authErrorMessage(error, preferences.locale)}</FormError>}
      <div className="flex items-center gap-3 text-[12px] text-subtle">
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
        {m.auth_page_or()}
        <span aria-hidden="true" className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}

/** The line under a form, e.g. "Belum punya akun? Daftar". */
export function AuthFoot({ children }: { children: ReactNode }) {
  return <p className="text-center text-[13px] text-muted-fg">{children}</p>;
}

/** Link style inside `AuthFoot` and next to field labels. */
export const AUTH_LINK =
  'rounded-[4px] font-medium text-blue-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
