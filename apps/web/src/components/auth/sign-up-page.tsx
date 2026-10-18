// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sign-up (design `zPHkt`, FR-A1). Instances that are not open to everyone accept sign-ups only through an
 * invitation link (`?invitation=`); without one the page says so instead of showing a form the server would refuse.
 */
import { Link } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { PageState } from '@wf/ui/page-state';
import { useState } from 'react';
import type { AuthFailure } from '../../lib/auth-client.ts';
import { authErrorMessage } from '../../lib/auth-errors.ts';
import { hardNavigate } from '../../lib/navigation.ts';
import type { Gate } from '../../server/gate.ts';
import { useAuthActions } from '../auth-actions.tsx';
import { AuthHeading } from '../auth-layout.tsx';
import { Button, Field, FormError, TextInput } from '../form.tsx';
import { PasswordInput } from '../password-field.tsx';
import { usePreferences } from '../preferences.tsx';
import { AUTH_LINK, AuthFoot, GoogleSignIn } from './parts.tsx';

export interface SignUpPageProps {
  /** `?invitation=` token from the invitation email. */
  invitation: string | undefined;
  registrationMode: Gate['registrationMode'];
  googleEnabled: boolean;
}

function SignInFoot() {
  return (
    <AuthFoot>
      {m.signup_have_account()}{' '}
      <Link to="/sign-in" className={AUTH_LINK}>
        {m.auth_page_sign_in()}
      </Link>
    </AuthFoot>
  );
}

export function SignUpPage({ invitation, registrationMode, googleEnabled }: SignUpPageProps) {
  const actions = useAuthActions();
  const { preferences } = usePreferences();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AuthFailure | null>(null);

  if (registrationMode !== 'open' && invitation === undefined) {
    return (
      <>
        <PageState kind="empty" title={m.signup_closed_title()} description={m.signup_closed_description()} />
        <SignInFoot />
      </>
    );
  }

  const submit = async () => {
    setPending(true);
    setError(null);
    const result = await actions.signUpEmail({
      name,
      email,
      password,
      locale: preferences.locale,
      invitationToken: invitation ?? null,
    });
    if (!result.ok) {
      setError(result.error);
      setPending(false);
      return;
    }
    hardNavigate('/');
  };

  return (
    <>
      <AuthHeading title={m.signup_title()} description={m.signup_description()} />
      {googleEnabled ? <GoogleSignIn callbackURL="/" /> : null}
      <form
        className="flex flex-col gap-[18px]"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Field label={m.signup_name()}>
          {({ id }) => (
            <TextInput
              id={id}
              name="name"
              autoComplete="name"
              required
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={m.auth_page_email()}>
          {({ id }) => (
            <TextInput
              id={id}
              name="email"
              type="email"
              autoComplete="email"
              required
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
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
        />
        {error === null ? null : <FormError>{authErrorMessage(error, preferences.locale)}</FormError>}
        <Button type="submit" pending={pending}>
          {m.signup_submit()}
        </Button>
      </form>
      <SignInFoot />
    </>
  );
}
