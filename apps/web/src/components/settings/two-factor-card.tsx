// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Verifikasi dua langkah" in Settings › Keamanan (design `kKAEZ`, FR-A4, FR-A9): the authenticator app (turn on,
 * or off with the password; mandatory for admins), passkeys (add with a name, remove), and new backup codes.
 */
import { useRouter } from '@tanstack/react-router';
import { formatDate } from '@wf/i18n/format';
import { m } from '@wf/i18n/messages';
import { ConfirmDialog } from '@wf/ui/confirm-dialog';
import { useState, type ReactNode } from 'react';
import type { AuthResult } from '../../lib/auth-client.ts';
import { authErrorMessage } from '../../lib/auth-errors.ts';
import type { PasskeyView } from '../../server/account.ts';
import { useAuthActions } from '../auth-actions.tsx';
import { BackupCodes } from '../backup-codes.tsx';
import { Button, Field, FormError, TextInput } from '../form.tsx';
import { Modal } from '../modal.tsx';
import { PasswordInput } from '../password-field.tsx';
import { usePreferences } from '../preferences.tsx';
import { TotpEnrollment } from '../totp-enrollment.tsx';
import { retryAfterReauth, type Reauthenticate } from './reauth.tsx';
import { Badge, SettingsGroup, SettingsRow } from './settings-ui.tsx';

export interface TwoFactorCardProps {
  twoFactorEnabled: boolean;
  hasPassword: boolean;
  isAdmin: boolean;
  passkeys: readonly PasskeyView[];
  reauthenticate: Reauthenticate;
}

/**
 * A dialog form with the account password (when it has one) for "Nonaktifkan" and "Buat kode baru": runs `action`,
 * retrying after re-authentication, and reports success with its value.
 */
function PasswordStep<T>({
  hasPassword,
  intro,
  submitLabel,
  destructive = false,
  action,
  reauthenticate,
  onSuccess,
  onCancel,
}: {
  hasPassword: boolean;
  intro: string;
  submitLabel: string;
  destructive?: boolean;
  action: (password: string | null) => Promise<AuthResult<T>>;
  reauthenticate: Reauthenticate;
  onSuccess: (value: T) => void;
  onCancel: () => void;
}) {
  const { preferences } = usePreferences();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (): Promise<void> => {
    setPending(true);
    setError(null);
    const result = await retryAfterReauth(() => action(hasPassword ? password : null), reauthenticate);
    setPending(false);
    if (result.ok) onSuccess(result.value);
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
      <p className="text-[13px] text-muted-fg">{intro}</p>
      {hasPassword ? (
        <PasswordInput
          label={m.security_password_label()}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          size="sm"
        />
      ) : null}
      {error === null ? null : <FormError>{error}</FormError>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          {m.settings_cancel()}
        </Button>
        <Button
          type="submit"
          size="sm"
          variant={destructive ? 'destructive' : 'primary'}
          pending={pending}
          disabled={hasPassword && password === ''}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function AddPasskeyForm({
  reauthenticate,
  onAdded,
  onCancel,
}: {
  reauthenticate: Reauthenticate;
  onAdded: () => void;
  onCancel: () => void;
}) {
  const actions = useAuthActions();
  const { preferences } = usePreferences();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submit = async (): Promise<void> => {
    setPending(true);
    setError(null);
    const result = await retryAfterReauth(() => actions.addPasskey(name.trim()), reauthenticate);
    setPending(false);
    if (result.ok) onAdded();
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
      <Field label={m.passkey_name_label()} hint={m.passkey_name_hint()} error={error}>
        {({ id, describedBy, invalid }) => (
          <TextInput
            id={id}
            size="sm"
            maxLength={60}
            value={name}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            onChange={(event) => {
              setName(event.target.value);
            }}
          />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          {m.settings_cancel()}
        </Button>
        <Button type="submit" size="sm" pending={pending} disabled={name.trim() === ''}>
          {m.passkey_add_continue()}
        </Button>
      </div>
    </form>
  );
}

type Dialog = 'enroll' | 'disable' | 'add-passkey' | 'backup-codes' | null;

export function TwoFactorCard({
  twoFactorEnabled,
  hasPassword,
  isAdmin,
  passkeys,
  reauthenticate,
}: TwoFactorCardProps) {
  const actions = useAuthActions();
  const { preferences } = usePreferences();
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [codes, setCodes] = useState<readonly string[] | null>(null);
  const [removing, setRemoving] = useState<PasskeyView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setDialog(null);
    setCodes(null);
  };
  const closeAndReload = () => {
    close();
    void router.invalidate();
  };

  const removePasskey = async (passkey: PasskeyView): Promise<void> => {
    setError(null);
    const result = await retryAfterReauth(() => actions.deletePasskey(passkey.id), reauthenticate);
    if (!result.ok) setError(authErrorMessage(result.error, preferences.locale));
    void router.invalidate();
  };

  let authenticator: ReactNode;
  if (!twoFactorEnabled) {
    authenticator = (
      <Button
        size="sm"
        onClick={() => {
          setDialog('enroll');
        }}
      >
        {m.security_totp_enable()}
      </Button>
    );
  } else if (isAdmin) {
    authenticator = <Badge>{m.security_totp_active()}</Badge>;
  } else {
    authenticator = (
      <div className="flex items-center gap-2">
        <Badge>{m.security_totp_active()}</Badge>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setDialog('disable');
          }}
        >
          {m.security_totp_disable()}
        </Button>
      </div>
    );
  }

  return (
    <SettingsGroup label={m.security_group_two_factor()}>
      <SettingsRow
        title={m.security_totp_title()}
        description={twoFactorEnabled && isAdmin ? m.security_totp_admin_required() : m.security_totp_description()}
      >
        {authenticator}
      </SettingsRow>
      <SettingsRow title={m.passkey_title()} description={m.passkey_description()}>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setDialog('add-passkey');
          }}
        >
          {m.passkey_add()}
        </Button>
      </SettingsRow>
      {passkeys.length === 0 ? null : (
        <ul aria-label={m.passkey_list_label()} className="flex flex-col divide-y divide-border">
          {passkeys.map((passkey) => (
            <li key={passkey.id} className="flex items-center gap-3 py-2 pr-3.5 pl-7 text-[12.5px]">
              <span className="flex-1 text-text-secondary">
                {passkey.name ?? m.passkey_unnamed()}
                <span className="text-subtle">
                  {` · ${m.passkey_added({ date: formatDate(passkey.createdAt, preferences.locale) })}`}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={m.passkey_remove_label({ name: passkey.name ?? m.passkey_unnamed() })}
                onClick={() => {
                  setRemoving(passkey);
                }}
              >
                {m.passkey_remove()}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <SettingsRow title={m.security_backup_title()} description={m.security_backup_description()}>
        <Button
          variant="secondary"
          size="sm"
          disabled={!twoFactorEnabled}
          onClick={() => {
            setDialog('backup-codes');
          }}
        >
          {m.security_backup_generate()}
        </Button>
      </SettingsRow>
      {error === null ? null : (
        <div className="p-3">
          <FormError>{error}</FormError>
        </div>
      )}

      <Modal open={dialog === 'enroll'} onOpenChange={closeAndReload} title={m.totp_title()} hideTitle size="lg">
        <TotpEnrollment
          needsPassword={hasPassword}
          onDone={closeAndReload}
          onCancel={closeAndReload}
          reauthenticate={reauthenticate}
        />
      </Modal>
      <Modal open={dialog === 'disable'} onOpenChange={closeAndReload} title={m.security_totp_disable_title()}>
        <PasswordStep
          hasPassword={hasPassword}
          intro={m.security_totp_disable_intro()}
          submitLabel={m.security_totp_disable()}
          destructive
          action={actions.disableTwoFactor}
          reauthenticate={reauthenticate}
          onSuccess={closeAndReload}
          onCancel={close}
        />
      </Modal>
      <Modal open={dialog === 'add-passkey'} onOpenChange={closeAndReload} title={m.passkey_add_title()}>
        <AddPasskeyForm reauthenticate={reauthenticate} onAdded={closeAndReload} onCancel={close} />
      </Modal>
      <Modal open={dialog === 'backup-codes'} onOpenChange={closeAndReload} title={m.security_backup_title()}>
        {codes === null ? (
          <PasswordStep
            hasPassword={hasPassword}
            intro={m.security_backup_intro()}
            submitLabel={m.security_backup_generate()}
            action={actions.generateBackupCodes}
            reauthenticate={reauthenticate}
            onSuccess={(value) => {
              setCodes(value.backupCodes);
            }}
            onCancel={close}
          />
        ) : (
          <BackupCodes codes={codes} onDone={closeAndReload} />
        )}
      </Modal>
      {removing === null ? null : (
        <ConfirmDialog
          open
          onOpenChange={() => {
            setRemoving(null);
          }}
          title={m.passkey_remove_title()}
          description={m.passkey_remove_description({ name: removing.name ?? m.passkey_unnamed() })}
          confirmLabel={m.passkey_remove()}
          cancelLabel={m.settings_cancel()}
          variant="destructive"
          onConfirm={() => {
            void removePasskey(removing);
          }}
        />
      )}
    </SettingsGroup>
  );
}
