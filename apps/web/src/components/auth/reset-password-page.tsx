// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The page behind the reset link (FR-A3): Better Auth checks the link and sends the browser here with `?token=`,
 * or with `?error=INVALID_TOKEN` when the link expired or was used.
 */
import { Link } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { useState } from 'react';
import type { AuthFailure } from '../../lib/auth-client.ts';
import { authErrorMessage } from '../../lib/auth-errors.ts';
import { useAuthActions } from '../auth-actions.tsx';
import { AuthHeading } from '../auth-layout.tsx';
import { Button, Field, FormError, TextInput } from '../form.tsx';
import { PasswordInput } from '../password-field.tsx';
import { usePreferences } from '../preferences.tsx';

export interface ResetPasswordPageProps {
  token: string | undefined;
  /** Better Auth's verdict on the link (`INVALID_TOKEN`). */
  error: string | undefined;
}

const BUTTON_LINK =
  'inline-flex h-[42px] items-center justify-center rounded-[9px] bg-fg px-4 text-[14px] font-semibold text-primary-fg hover:bg-text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export function ResetPasswordPage({ token, error: linkError }: ResetPasswordPageProps) {
  const actions = useAuthActions();
  const { preferences } = usePreferences();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AuthFailure | null>(null);
  const [done, setDone] = useState(false);
  // An expired or used link: only a new one helps.
  const deadLink = error?.code === 'INVALID_TOKEN' || error?.code === 'TOKEN_EXPIRED';
  if (token === undefined || linkError !== undefined || deadLink) {
    return (
      <>
        <AuthHeading title={m.reset_invalid_title()} description={m.reset_invalid_description()} />
        <Link to="/forgot" className={BUTTON_LINK}>
          {m.reset_request_new()}
        </Link>
      </>
    );
  }

  if (done) {
    return (
      <>
        <AuthHeading title={m.reset_done_title()} description={m.reset_done_description()} />
        <Link to="/sign-in" className={BUTTON_LINK}>
          {m.auth_page_sign_in()}
        </Link>
      </>
    );
  }

  const submit = async () => {
    if (password !== confirm) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    setPending(true);
    setError(null);
    const result = await actions.resetPassword({ token, newPassword: password });
    setPending(false);
    if (result.ok) setDone(true);
    else setError(result.error);
  };

  return (
    <>
      <AuthHeading title={m.reset_title()} description={m.reset_description()} />
      <form
        className="flex flex-col gap-[18px]"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <PasswordInput
          label={m.reset_new_password()}
          name="new-password"
          autoComplete="new-password"
          value={password}
          onChange={setPassword}
        />
        <Field label={m.reset_confirm()} error={mismatch ? m.reset_mismatch() : null}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              name="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={confirm}
              onChange={(event) => {
                setConfirm(event.target.value);
              }}
            />
          )}
        </Field>
        {error === null ? null : <FormError>{authErrorMessage(error, preferences.locale)}</FormError>}
        <Button type="submit" pending={pending}>
          {m.reset_submit()}
        </Button>
      </form>
    </>
  );
}
