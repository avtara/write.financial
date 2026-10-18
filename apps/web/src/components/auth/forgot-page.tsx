// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Forgot password (FR-A3, design `L4tjTX`): asks for the email, then confirms the link was sent and offers to send
 * it again after a minute. The answer is the same whether or not the email has an account; Google-only accounts
 * get a "set a password" link instead.
 */
import { Link } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { MailCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AuthFailure } from '../../lib/auth-client.ts';
import { authErrorMessage, clockTime } from '../../lib/auth-errors.ts';
import { useAuthActions } from '../auth-actions.tsx';
import { AuthHeading } from '../auth-layout.tsx';
import { Button, Field, FormError, TextInput } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';
import { AUTH_LINK, AuthFoot } from './parts.tsx';

/** Seconds before the link can be sent again. */
export const RESEND_COOLDOWN_SECONDS = 60;

export function ForgotPage() {
  const actions = useAuthActions();
  const { preferences } = usePreferences();
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AuthFailure | null>(null);
  const [sentAt, setSentAt] = useState<Date | null>(null);
  // The clock of the resend countdown: set when the email goes out, then every second until the cooldown ends.
  const [now, setNow] = useState(0);
  const secondsLeft =
    sentAt === null ? 0 : Math.max(0, Math.ceil((sentAt.getTime() + RESEND_COOLDOWN_SECONDS * 1000 - now) / 1000));
  useEffect(() => {
    if (secondsLeft === 0) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [secondsLeft]);

  const send = async () => {
    setPending(true);
    setError(null);
    const result = await actions.requestPasswordReset(email);
    setPending(false);
    if (result.ok) {
      const at = new Date();
      setSentAt(at);
      setNow(at.getTime());
    } else {
      setError(result.error);
    }
  };
  const errorMessage = error === null ? null : authErrorMessage(error, preferences.locale);
  const foot = (
    <AuthFoot>
      {m.forgot_remembered()}{' '}
      <Link to="/sign-in" className={AUTH_LINK}>
        {m.auth_page_sign_in()}
      </Link>
    </AuthFoot>
  );

  if (sentAt !== null) {
    return (
      <>
        <AuthHeading title={m.forgot_sent_title()} description={m.forgot_sent_description({ email })} />
        <div role="status" className="flex items-start gap-2.5 rounded-[9px] bg-green-tint-2 px-3.5 py-3">
          <MailCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-green-fg" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-medium text-green-fg">
              {m.forgot_sent_at({ time: clockTime(sentAt, preferences.locale) })}
            </span>
            <span className="text-[12px] text-muted-fg">{m.forgot_spam()}</span>
          </div>
        </div>
        {errorMessage === null ? null : <FormError>{errorMessage}</FormError>}
        {secondsLeft > 0 ? (
          <p className="text-center text-[13px] text-subtle">
            {m.forgot_resend_in({
              time: `${String(Math.floor(secondsLeft / 60))}:${String(secondsLeft % 60).padStart(2, '0')}`,
            })}
          </p>
        ) : (
          <Button variant="secondary" pending={pending} onClick={() => void send()}>
            {m.forgot_resend()}
          </Button>
        )}
        {foot}
      </>
    );
  }

  return (
    <>
      <AuthHeading title={m.forgot_title()} description={m.forgot_description()} />
      <form
        className="flex flex-col gap-[18px]"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <Field label={m.auth_page_email()} error={errorMessage}>
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              name="email"
              type="email"
              autoComplete="email"
              required
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          )}
        </Field>
        <Button type="submit" pending={pending}>
          {m.forgot_submit()}
        </Button>
      </form>
      {foot}
    </>
  );
}
