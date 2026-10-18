// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Turning on the authenticator app (FR-A4, design `NKmY8`), used by the setup wizard, `/two-factor-setup`, and
 * Settings › Keamanan: the password (accounts that have one), then the QR code and manual key, the first 6-digit code
 * (which turns 2FA on), and the 10 backup codes shown once. The QR code is drawn as SVG rectangles, so the CSP needs
 * no `data:` image or inline style for it.
 */
import { m } from '@wf/i18n/messages';
import { CodeInput } from '@wf/ui/code-input';
import { Check, Copy, LockKeyhole, ShieldCheck } from 'lucide-react';
import { create } from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { authErrorMessage, needsReauthentication } from '../lib/auth-errors.ts';
import { useAuthActions } from './auth-actions.tsx';
import { BackupCodes } from './backup-codes.tsx';
import { Button, FormError } from './form.tsx';
import { PasswordInput } from './password-field.tsx';
import { usePreferences } from './preferences.tsx';

export interface TotpEnrollmentProps {
  /** The account has a password, which Better Auth requires to start enrollment. */
  needsPassword: boolean;
  /** A password the caller already has (the setup wizard, right after creating the admin): no prompt. */
  initialPassword?: string;
  /** 2FA is on and the backup codes are saved. */
  onDone: () => void;
  /** Shows "Batal" before 2FA is on. */
  onCancel?: () => void;
  /** Asked when starting fails because the session is older than 15 minutes (FR-A9); resolves `true` once the user
   * signed in again, and enrollment starts over. Without it the failure is shown. */
  reauthenticate?: () => Promise<boolean>;
}

type Stage =
  | { readonly step: 'password' }
  | { readonly step: 'starting' }
  | { readonly step: 'start-failed' }
  | { readonly step: 'scan'; readonly totpURI: string; readonly backupCodes: readonly string[] }
  | { readonly step: 'codes'; readonly backupCodes: readonly string[] };

/** Quiet zone around the symbol, in modules (the QR spec asks for 4). */
const QUIET_ZONE = 4;

/** Dark modules of `text`'s QR code as one rectangle per horizontal run. */
export function qrRuns(text: string): { size: number; runs: { x: number; y: number; width: number }[] } {
  const { modules } = create(text, { errorCorrectionLevel: 'M' });
  const runs: { x: number; y: number; width: number }[] = [];
  for (let y = 0; y < modules.size; y++) {
    let start = -1;
    for (let x = 0; x <= modules.size; x++) {
      const dark = x < modules.size && modules.get(y, x);
      if (dark && start < 0) start = x;
      if (!dark && start >= 0) {
        runs.push({ x: start + QUIET_ZONE, y: y + QUIET_ZONE, width: x - start });
        start = -1;
      }
    }
  }
  return { size: modules.size + 2 * QUIET_ZONE, runs };
}

function QrCode({ text }: { text: string }) {
  const { size, runs } = qrRuns(text);
  return (
    <svg
      role="img"
      aria-label={m.totp_qr_label()}
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      shapeRendering="crispEdges"
      className="size-[132px] shrink-0 rounded-[10px]"
    >
      <rect width={size} height={size} fill="#fff" />
      {runs.map(({ x, y, width }) => (
        <rect key={`${String(x)}-${String(y)}`} x={x} y={y} width={width} height={1} fill="#000" />
      ))}
    </svg>
  );
}

/** `secret`: the base32 key of the `otpauth://` URI, shown in groups of 4 (`JBSW Y3DP EHPK 3PXP`). */
function ManualKey({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-muted-fg">{m.totp_manual_key()}</span>
      <div className="flex items-center gap-2 rounded-[8px] border border-border bg-surface-sunken px-3 py-2">
        <code className="flex-1 font-mono text-[13px] tracking-[0.04em] break-all text-fg">
          {secret.replace(/(.{4})(?=.)/g, '$1 ')}
        </code>
        <button
          type="button"
          aria-label={copied ? m.totp_copied() : m.totp_copy_key()}
          onClick={() => {
            void navigator.clipboard.writeText(secret).then(() => {
              setCopied(true);
            });
          }}
          className="flex size-7 items-center justify-center rounded-[6px] text-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          {copied ? (
            <Check aria-hidden="true" className="size-3.5" />
          ) : (
            <Copy aria-hidden="true" className="size-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

function Header({ subtitle }: { subtitle: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[9px] bg-surface-3 text-fg">
        <ShieldCheck aria-hidden="true" className="size-[18px]" />
      </span>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-[16px] font-semibold text-fg">{m.totp_title()}</h2>
        <p className="text-[12.5px] text-muted-fg">{subtitle}</p>
      </div>
    </div>
  );
}

const STEPS = [m.totp_instruction_open, m.totp_instruction_scan, m.totp_instruction_enter] as const;

export function TotpEnrollment({
  needsPassword,
  initialPassword,
  onDone,
  onCancel,
  reauthenticate,
}: TotpEnrollmentProps) {
  const actions = useAuthActions();
  const { preferences } = usePreferences();
  const prompt = needsPassword && initialPassword === undefined;
  const [stage, setStage] = useState<Stage>({ step: prompt ? 'password' : 'starting' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const start = async (value: string | null): Promise<void> => {
    setPending(true);
    setError(null);
    let result = await actions.enableTwoFactor(value);
    if (!result.ok && needsReauthentication(result.error.code) && reauthenticate !== undefined) {
      if (await reauthenticate()) result = await actions.enableTwoFactor(value);
    }
    setPending(false);
    if (result.ok) {
      setStage({ step: 'scan', totpURI: result.value.totpURI, backupCodes: result.value.backupCodes });
      return;
    }
    setError(authErrorMessage(result.error, preferences.locale));
    setStage({ step: needsPassword ? 'password' : 'start-failed' });
  };

  // Starts on its own when no password must be typed; the ref keeps a StrictMode re-run from enrolling twice.
  const started = useRef(false);
  useEffect(() => {
    if (prompt || started.current) return;
    started.current = true;
    void start(initialPassword ?? null);
  });

  const verify = async (backupCodes: readonly string[]): Promise<void> => {
    setPending(true);
    setError(null);
    const result = await actions.verifyTotp({ code, trustDevice: false });
    setPending(false);
    if (result.ok) setStage({ step: 'codes', backupCodes });
    else setError(authErrorMessage(result.error, preferences.locale));
  };

  const cancel =
    onCancel === undefined ? null : (
      <Button variant="secondary" size="sm" onClick={onCancel}>
        {m.totp_cancel()}
      </Button>
    );

  if (stage.step === 'codes') {
    return (
      <div className="flex flex-col gap-5">
        <Header subtitle={m.totp_step_codes()} />
        <BackupCodes codes={stage.backupCodes} onDone={onDone} />
      </div>
    );
  }

  if (stage.step === 'scan') {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void verify(stage.backupCodes);
        }}
        className="flex flex-col gap-5"
      >
        <Header subtitle={m.totp_step_scan()} />
        <div className="flex gap-4">
          <QrCode text={stage.totpURI} />
          <ol className="flex flex-col gap-2.5 text-[13px] text-text-secondary">
            {STEPS.map((step, index) => (
              <li key={step()} className="flex gap-2">
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] font-medium text-fg">
                  {index + 1}
                </span>
                {step()}
              </li>
            ))}
          </ol>
        </div>
        <ManualKey secret={new URL(stage.totpURI).searchParams.get('secret') ?? ''} />
        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-muted-fg">{m.totp_code_label()}</span>
          <CodeInput
            label={m.totp_code_label()}
            digitLabel={(position, length) => m.totp_digit_label({ position, length })}
            onChange={setCode}
            invalid={error !== null}
            disabled={pending}
          />
        </div>
        {error === null ? null : <FormError>{error}</FormError>}
        <p className="rounded-[8px] bg-tint-04 px-3 py-2 text-[12.5px] text-text-secondary">{m.totp_backup_note()}</p>
        <div className="flex items-center gap-2 border-t border-border pt-4">
          <span className="flex flex-1 items-center gap-1.5 text-[11.5px] text-subtle">
            <LockKeyhole aria-hidden="true" className="size-3" />
            {m.totp_secret_hint()}
          </span>
          {cancel}
          <Button type="submit" size="sm" pending={pending} disabled={code.length !== 6}>
            {m.totp_verify()}
          </Button>
        </div>
      </form>
    );
  }

  if (stage.step === 'password') {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void start(password);
        }}
        className="flex flex-col gap-5"
      >
        <Header subtitle={m.totp_step_scan()} />
        <p className="text-[13px] text-muted-fg">{m.totp_password_intro()}</p>
        <PasswordInput
          label={m.totp_password_label()}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          error={error}
          size="sm"
        />
        <div className="flex justify-end gap-2">
          {cancel}
          <Button type="submit" size="sm" pending={pending} disabled={password === ''}>
            {m.totp_continue()}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Header subtitle={m.totp_step_scan()} />
      {stage.step === 'starting' ? (
        <p role="status" className="text-[13px] text-muted-fg">
          {m.totp_starting()}
        </p>
      ) : (
        <>
          <FormError>{error}</FormError>
          <div className="flex justify-end gap-2">
            {cancel}
            <Button
              size="sm"
              onClick={() => {
                void start(null);
              }}
            >
              {m.totp_retry()}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
