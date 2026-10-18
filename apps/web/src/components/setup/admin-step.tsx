// SPDX-License-Identifier: AGPL-3.0-only
import { m } from '@wf/i18n/messages';
import type { Locale } from '@wf/i18n/locale';
import { useState } from 'react';
import type { Result } from '../../server/access.ts';
import { useAuthActions } from '../auth-actions.tsx';
import { Button, Field, FormError, TextInput } from '../form.tsx';
import { MIN_PASSWORD_LENGTH, PasswordInput } from '../password-field.tsx';
import { usePreferences } from '../preferences.tsx';
import { resultMessage } from './result.ts';

export interface AdminInput {
  name: string;
  email: string;
  password: string;
  locale: Locale;
}

/** Where a refusal is shown: next to the field it is about, else above the button. */
const FIELD_OF: Readonly<Record<string, 'email' | 'password'>> = {
  EMAIL_TAKEN: 'email',
  INVALID_EMAIL: 'email',
  PASSWORD_COMPROMISED: 'password',
  PASSWORD_TOO_SHORT: 'password',
  PASSWORD_TOO_LONG: 'password',
};

export interface AdminStepProps {
  onCreate: (input: AdminInput) => Promise<Result<null>>;
  /** After the admin exists and the browser tried to sign in; `password` only when that worked (for 2FA enrollment). */
  onDone: (password: string | undefined) => Promise<void>;
}

/** Step 1: the first admin (in the interface language), then signs in as it. */
export function AdminStep({ onCreate, onDone }: AdminStepProps) {
  const { preferences } = usePreferences();
  const actions = useAuthActions();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ field: 'email' | 'password' | 'form'; message: string } | null>(null);

  const submit = async () => {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError({ field: 'password', message: m.auth_error_password_too_short() });
      return;
    }
    setPending(true);
    setError(null);
    const created = await onCreate({ name: name.trim(), email: email.trim(), password, locale: preferences.locale });
    if (!created.ok) {
      setError({ field: FIELD_OF[created.code] ?? 'form', message: resultMessage(created, preferences.locale) });
      setPending(false);
      return;
    }
    const signedIn = await actions.signInEmail({ email: email.trim(), password, rememberMe: false });
    await onDone(signedIn.ok ? password : undefined);
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-3.5"
    >
      <Field label={m.setup_admin_name()}>
        {({ id }) => (
          <TextInput
            id={id}
            name="name"
            autoComplete="name"
            required
            maxLength={100}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        )}
      </Field>
      <Field label={m.setup_admin_email()} error={error?.field === 'email' ? error.message : null}>
        {({ id, describedBy, invalid }) => (
          <TextInput
            id={id}
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={320}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        )}
      </Field>
      <PasswordInput
        label={m.setup_admin_password()}
        name="password"
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
        error={error?.field === 'password' ? error.message : null}
      />
      {error?.field === 'form' ? <FormError>{error.message}</FormError> : null}
      <Button type="submit" pending={pending} className="mt-1 w-full">
        {m.setup_admin_submit()}
      </Button>
    </form>
  );
}
