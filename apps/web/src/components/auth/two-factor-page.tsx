// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The second step of sign-in (design `ZAD9u`, FR-A2): the authenticator code, or a backup code, or a passkey.
 * Wrong codes count towards the 15-minute lock like wrong passwords; when the sign-in it belongs to expired, the
 * only way on is to sign in again.
 */
import { Link } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { CodeInput } from '@wf/ui/code-input';
import { Fingerprint, Info, KeyRound } from 'lucide-react';
import { useId, useState } from 'react';
import type { AuthFailure, AuthResult } from '../../lib/auth-client.ts';
import { authErrorMessage } from '../../lib/auth-errors.ts';
import { hardNavigate, safeRedirect } from '../../lib/navigation.ts';
import { useAuthActions } from '../auth-actions.tsx';
import { AuthHeading } from '../auth-layout.tsx';
import { Button, Checkbox, Field, FormError, TextInput } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';
import { AUTH_LINK, AuthFoot } from './parts.tsx';

export interface TwoFactorPageProps {
  /** `?redirect=`: where to go afterwards. */
  redirect: string | undefined;
  /** `?previous=`: the session a re-authentication replaces, ended once this one exists. */
  previous: string | undefined;
  /** The email typed on the sign-in page, when the browser still knows it. */
  email: string | undefined;
  revokeSession: (id: string) => Promise<unknown>;
}

const CODE_LENGTH = 6;

const ALTERNATIVE =
  'inline-flex h-[38px] flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-border px-3 text-[12.5px] font-medium text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60';

export function TwoFactorPage({ redirect, previous, email, revokeSession }: TwoFactorPageProps) {
  const actions = useAuthActions();
  const { preferences } = usePreferences();
  const [mode, setMode] = useState<'totp' | 'backup'>('totp');
  const [code, setCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [trustDevice, setTrustDevice] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AuthFailure | null>(null);
  const [recoverOpen, setRecoverOpen] = useState(false);
  const recoverId = useId();

  const settle = async (request: Promise<AuthResult<null>>) => {
    setPending(true);
    setError(null);
    const result = await request;
    if (!result.ok) {
      // The digits stay, so a failed request can be retried with "Verifikasi" and one typo fixed in place.
      setError(result.error);
      setPending(false);
      return;
    }
    if (previous !== undefined) await revokeSession(previous);
    hardNavigate(safeRedirect(redirect));
  };
  const verify = (value: string) =>
    settle(
      mode === 'totp'
        ? actions.verifyTotp({ code: value, trustDevice })
        : actions.verifyBackupCode({ code: value.trim(), trustDevice }),
    );

  const expired = error?.code === 'INVALID_TWO_FACTOR_COOKIE';
  const message = error === null ? null : authErrorMessage(error, preferences.locale);

  return (
    <>
      <AuthHeading
        title={m.challenge_title()}
        description={email === undefined ? m.challenge_description() : m.challenge_description_email({ email })}
      />
      <form
        className="flex flex-col gap-[18px]"
        onSubmit={(event) => {
          event.preventDefault();
          void verify(mode === 'totp' ? code : backupCode);
        }}
      >
        {mode === 'totp' ? (
          <CodeInput
            label={m.challenge_code()}
            digitLabel={(position, length) => m.challenge_digit({ position, length })}
            length={CODE_LENGTH}
            onChange={setCode}
            onComplete={(value) => void verify(value)}
            invalid={error !== null}
            disabled={pending}
          />
        ) : (
          <Field label={m.challenge_backup_code()}>
            {({ id }) => (
              <TextInput
                id={id}
                name="backup-code"
                autoComplete="off"
                spellCheck={false}
                required
                aria-invalid={error !== null}
                className="font-mono"
                value={backupCode}
                onChange={(event) => {
                  setBackupCode(event.target.value);
                }}
              />
            )}
          </Field>
        )}
        {message === null ? null : (
          <FormError>
            {message}
            {expired ? (
              <>
                {' '}
                <Link to="/sign-in" search={{ redirect }} className={AUTH_LINK}>
                  {m.challenge_restart()}
                </Link>
              </>
            ) : null}
          </FormError>
        )}
        <Checkbox
          label={m.challenge_trust()}
          checked={trustDevice}
          onChange={(event) => {
            setTrustDevice(event.target.checked);
          }}
        />
        <Button type="submit" pending={pending} disabled={mode === 'totp' && code.length < CODE_LENGTH}>
          {m.challenge_submit()}
        </Button>
      </form>
      <div className="flex gap-2">
        <button
          type="button"
          className={ALTERNATIVE}
          disabled={pending}
          onClick={() => {
            setMode(mode === 'totp' ? 'backup' : 'totp');
            setCode('');
            setError(null);
          }}
        >
          <KeyRound aria-hidden="true" className="size-3.5" />
          {mode === 'totp' ? m.challenge_use_backup() : m.challenge_use_totp()}
        </button>
        <button
          type="button"
          className={ALTERNATIVE}
          disabled={pending}
          onClick={() => void settle(actions.signInPasskey())}
        >
          <Fingerprint aria-hidden="true" className="size-3.5" />
          {m.challenge_use_passkey()}
        </button>
      </div>
      <AuthFoot>
        {m.challenge_no_access()}{' '}
        <button
          type="button"
          aria-expanded={recoverOpen}
          aria-controls={recoverId}
          className={AUTH_LINK}
          onClick={() => {
            setRecoverOpen(!recoverOpen);
          }}
        >
          {m.challenge_recover()}
        </button>
      </AuthFoot>
      <p
        id={recoverId}
        hidden={!recoverOpen}
        className="rounded-[8px] bg-muted px-3 py-2 text-[12.5px] text-text-secondary"
      >
        {m.challenge_recover_help()}
      </p>
      <p className="flex items-center justify-center gap-1.5 text-[11.5px] text-subtle">
        <Info aria-hidden="true" className="size-3.5" />
        {m.challenge_hint()}
      </p>
    </>
  );
}
