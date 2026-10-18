// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The password of the account, in Profil & akun and Keamanan: "Ubah" (current + new password, optionally signing
 * the other devices out) or, for Google-only accounts, "Atur kata sandi", which emails a link to set one (FR-A3).
 */
import { useRouter } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { useState } from 'react';
import { authErrorMessage } from '../../lib/auth-errors.ts';
import { useAuthActions } from '../auth-actions.tsx';
import { Button, Checkbox, Field, FormError, FormNotice, TextInput } from '../form.tsx';
import { Modal } from '../modal.tsx';
import { PasswordInput } from '../password-field.tsx';
import { usePreferences } from '../preferences.tsx';
import { retryAfterReauth, type Reauthenticate } from './reauth.tsx';

function ChangePasswordForm({
  reauthenticate,
  onChanged,
  onCancel,
}: {
  reauthenticate: Reauthenticate;
  onChanged: () => void;
  onCancel: () => void;
}) {
  const actions = useAuthActions();
  const { preferences } = usePreferences();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [signOutOthers, setSignOutOthers] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (): Promise<void> => {
    if (next !== repeat) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    setPending(true);
    setError(null);
    const result = await retryAfterReauth(
      () => actions.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: signOutOthers }),
      reauthenticate,
    );
    setPending(false);
    if (result.ok) onChanged();
    else setError(authErrorMessage(result.error, preferences.locale));
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-4"
    >
      <PasswordInput
        label={m.security_password_current()}
        value={current}
        onChange={setCurrent}
        autoComplete="current-password"
        size="sm"
      />
      <PasswordInput
        label={m.security_password_new()}
        value={next}
        onChange={setNext}
        autoComplete="new-password"
        size="sm"
      />
      <Field label={m.security_password_repeat()} error={mismatch ? m.security_password_mismatch() : null}>
        {({ id, describedBy, invalid }) => (
          <TextInput
            id={id}
            type="password"
            size="sm"
            autoComplete="new-password"
            value={repeat}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            onChange={(event) => {
              setRepeat(event.target.value);
            }}
          />
        )}
      </Field>
      <Checkbox
        label={m.security_password_sign_out_others()}
        checked={signOutOthers}
        onChange={(event) => {
          setSignOutOthers(event.target.checked);
        }}
      />
      {error === null ? null : <FormError>{error}</FormError>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          {m.settings_cancel()}
        </Button>
        <Button type="submit" size="sm" pending={pending} disabled={current === '' || next === '' || repeat === ''}>
          {m.security_password_save()}
        </Button>
      </div>
    </form>
  );
}

export function PasswordControl({
  hasPassword,
  email,
  reauthenticate,
}: {
  hasPassword: boolean;
  email: string;
  reauthenticate: Reauthenticate;
}) {
  const actions = useAuthActions();
  const { preferences } = usePreferences();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const requestLink = async (): Promise<void> => {
    setPending(true);
    setError(null);
    const result = await actions.requestPasswordReset(email);
    setPending(false);
    if (result.ok) setNotice(m.security_password_link_sent({ email }));
    else setError(authErrorMessage(result.error, preferences.locale));
  };

  return (
    <div className="flex flex-col items-end gap-2">
      {hasPassword ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setNotice(null);
            setOpen(true);
          }}
        >
          {m.security_password_change()}
        </Button>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          pending={pending}
          onClick={() => {
            void requestLink();
          }}
        >
          {m.security_password_set()}
        </Button>
      )}
      {notice === null ? null : <FormNotice>{notice}</FormNotice>}
      {error === null ? null : <FormError>{error}</FormError>}
      <Modal open={open} onOpenChange={setOpen} title={m.security_password_change_title()}>
        <ChangePasswordForm
          reauthenticate={reauthenticate}
          onCancel={() => {
            setOpen(false);
          }}
          onChanged={() => {
            setOpen(false);
            setNotice(m.security_password_changed());
            void router.invalidate();
          }}
        />
      </Modal>
    </div>
  );
}
