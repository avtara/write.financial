// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Masuk lagi" for actions that need a session younger than 15 minutes (FR-A9): the password, then the authenticator
 * or a backup code when the account has 2FA. Signing in starts a new session, so the previous one is signed out
 * right after; `onDone` then retries the action. Accounts without a password continue on the sign-in page.
 */
import { useLocation } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { CodeInput } from '@wf/ui/code-input';
import { useState } from 'react';
import { authErrorMessage } from '../lib/auth-errors.ts';
import { hardNavigate } from '../lib/navigation.ts';
import { revokeDevice } from '../server/fn/account.ts';
import { useAuthActions } from './auth-actions.tsx';
import { Button, Field, FormError, TextInput } from './form.tsx';
import { Modal } from './modal.tsx';
import { PasswordInput } from './password-field.tsx';
import { usePreferences } from './preferences.tsx';

export interface ReauthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  /** The current session (`viewer.sessionId`), signed out once the new one exists. */
  sessionId: string;
  onDone: () => void;
}

type Step = 'password' | 'totp' | 'backup';

function ReauthForm({
  email,
  sessionId,
  onDone,
  onCancel,
}: Omit<ReauthDialogProps, 'open' | 'onOpenChange'> & { onCancel: () => void }) {
  const actions = useAuthActions();
  const { preferences } = usePreferences();
  const location = useLocation();
  const [step, setStep] = useState<Step>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const finish = async (): Promise<void> => {
    // The new session's cookie is set by now; the old session ends so only one stays on this device.
    await revokeDevice({ data: { id: sessionId } });
    onDone();
  };

  const submit = async (): Promise<void> => {
    setPending(true);
    setError(null);
    if (step === 'password') {
      const result = await actions.signInEmail({ email, password, rememberMe: true });
      if (!result.ok) {
        setPending(false);
        setError(authErrorMessage(result.error, preferences.locale));
        return;
      }
      if (result.value.twoFactor) {
        setPending(false);
        setStep('totp');
        return;
      }
    } else {
      const verify = step === 'totp' ? actions.verifyTotp : actions.verifyBackupCode;
      const result = await verify({ code, trustDevice: false });
      if (!result.ok) {
        setPending(false);
        setError(authErrorMessage(result.error, preferences.locale));
        return;
      }
    }
    await finish();
  };

  const switchTo = (next: Step) => {
    setStep(next);
    setCode('');
    setError(null);
  };

  const ready = step === 'password' ? password !== '' : code.length >= 6;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-4"
    >
      {step === 'password' ? (
        <>
          <p className="text-[13px] text-muted-fg">{m.reauth_password_intro({ email })}</p>
          <PasswordInput
            label={m.reauth_password_label()}
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            error={error}
            size="sm"
          />
          <button
            type="button"
            onClick={() => {
              hardNavigate(`/sign-in?reauth=1&redirect=${encodeURIComponent(location.href)}`);
            }}
            className="self-start text-[12.5px] font-medium text-blue-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {m.reauth_other_method()}
          </button>
        </>
      ) : null}
      {step === 'totp' ? (
        <>
          <p className="text-[13px] text-muted-fg">{m.reauth_totp_intro()}</p>
          <CodeInput
            label={m.reauth_totp_label()}
            digitLabel={(position, length) => m.totp_digit_label({ position, length })}
            onChange={setCode}
            invalid={error !== null}
            disabled={pending}
          />
          {error === null ? null : <FormError>{error}</FormError>}
          <button
            type="button"
            onClick={() => {
              switchTo('backup');
            }}
            className="self-start text-[12.5px] font-medium text-blue-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {m.reauth_use_backup()}
          </button>
        </>
      ) : null}
      {step === 'backup' ? (
        <>
          <Field label={m.reauth_backup_label()} error={error}>
            {({ id, describedBy, invalid }) => (
              <TextInput
                id={id}
                size="sm"
                autoComplete="one-time-code"
                spellCheck={false}
                value={code}
                aria-describedby={describedBy}
                aria-invalid={invalid}
                onChange={(event) => {
                  setCode(event.target.value.trim());
                }}
                className="font-mono"
              />
            )}
          </Field>
          <button
            type="button"
            onClick={() => {
              switchTo('totp');
            }}
            className="self-start text-[12.5px] font-medium text-blue-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {m.reauth_use_totp()}
          </button>
        </>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          {m.reauth_cancel()}
        </Button>
        <Button type="submit" size="sm" pending={pending} disabled={!ready}>
          {step === 'password' ? m.reauth_continue() : m.reauth_verify()}
        </Button>
      </div>
    </form>
  );
}

export function ReauthDialog({ open, onOpenChange, email, sessionId, onDone }: ReauthDialogProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={m.reauth_title()}>
      <ReauthForm
        email={email}
        sessionId={sessionId}
        onDone={onDone}
        onCancel={() => {
          onOpenChange(false);
        }}
      />
    </Modal>
  );
}
