// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sign-in (design `GNOjT`; wrong password `D0gWC`). With `reauth` the signed-in viewer confirms their password
 * again before a sensitive action (FR-A9): the email is fixed, and the session they had is ended once the new one
 * exists, so re-authenticating never leaves an extra session behind.
 */
import { Link, useNavigate } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { useState } from 'react';
import type { AuthFailure } from '../../lib/auth-client.ts';
import { authErrorMessage } from '../../lib/auth-errors.ts';
import { hardNavigate, safeRedirect } from '../../lib/navigation.ts';
import type { Viewer } from '../../server/gate.ts';
import { useAuthActions } from '../auth-actions.tsx';
import { AuthHeading } from '../auth-layout.tsx';
import { Button, Checkbox, Field, TextInput } from '../form.tsx';
import { PasswordInput } from '../password-field.tsx';
import { usePreferences } from '../preferences.tsx';
import { AUTH_LINK, AuthFoot, GoogleSignIn } from './parts.tsx';

export interface SignInPageProps {
  /** `?redirect=`: where to go afterwards (checked with `safeRedirect`). */
  redirect: string | undefined;
  /** The signed-in viewer confirming their password again (`?reauth=1`), else `null`. */
  reauthViewer: Viewer | null;
  googleEnabled: boolean;
  /** Whether "Daftar" is offered (registration is not closed). */
  signUpOffered: boolean;
  /** Ends the viewer's previous session after a re-authentication. */
  revokeSession: (id: string) => Promise<unknown>;
}

export function SignInPage({ redirect, reauthViewer, googleEnabled, signUpOffered, revokeSession }: SignInPageProps) {
  const actions = useAuthActions();
  const navigate = useNavigate();
  const { preferences } = usePreferences();
  const [email, setEmail] = useState(reauthViewer?.email ?? '');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AuthFailure | null>(null);
  const destination = safeRedirect(redirect);

  const submit = async () => {
    setPending(true);
    setError(null);
    const result = await actions.signInEmail({ email, password, rememberMe });
    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }
    if (result.value.twoFactor) {
      await navigate({
        to: '/2fa',
        search: { redirect, previous: reauthViewer?.sessionId },
        state: (previous) => ({ ...previous, email }),
      });
      return;
    }
    if (reauthViewer !== null) await revokeSession(reauthViewer.sessionId);
    hardNavigate(destination);
  };

  return (
    <>
      <AuthHeading
        title={reauthViewer === null ? m.signin_title() : m.signin_reauth_title()}
        description={reauthViewer === null ? m.signin_description() : m.signin_reauth_description()}
      />
      {googleEnabled && reauthViewer === null ? <GoogleSignIn callbackURL={destination} /> : null}
      <form
        className="flex flex-col gap-[18px]"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label={m.auth_page_email()}>
          {({ id }) => (
            <TextInput
              id={id}
              name="email"
              type="email"
              autoComplete="username"
              required
              readOnly={reauthViewer !== null}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          )}
        </Field>
        <PasswordInput
          label={m.auth_page_password()}
          name="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          error={error === null ? null : authErrorMessage(error, preferences.locale)}
          aside={
            <Link to="/forgot" className={`text-[12.5px] ${AUTH_LINK}`}>
              {m.signin_forgot()}
            </Link>
          }
        />
        <Checkbox
          label={m.signin_remember()}
          checked={rememberMe}
          onChange={(event) => {
            setRememberMe(event.target.checked);
          }}
        />
        <Button type="submit" pending={pending}>
          {m.auth_page_sign_in()}
        </Button>
      </form>
      {signUpOffered && reauthViewer === null ? (
        <AuthFoot>
          {m.signin_no_account()}{' '}
          <Link to="/sign-up" className={AUTH_LINK}>
            {m.signin_sign_up()}
          </Link>
        </AuthFoot>
      ) : null}
    </>
  );
}
