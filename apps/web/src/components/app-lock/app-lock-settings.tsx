// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › Keamanan › Akses rows for the app lock (design `pdmek`, FR-A6): "Kunci aplikasi" turns the PIN on (chosen
 * and repeated) or off (the current PIN first), and while it is on "Kunci otomatis" picks the idle minutes and
 * "Ganti PIN" sets a new one after the current. Everything applies to this device only.
 */
import { m } from '@wf/i18n/messages';
import { Switch } from '@wf/ui/switch';
import { useId, useState } from 'react';
import { Button, Select } from '../form.tsx';
import { Modal } from '../modal.tsx';
import { SettingsRow } from '../settings/settings-ui.tsx';
import { useAppLock } from './app-lock.tsx';
import { PinPad } from './pin-pad.tsx';
import { LOCK_TIMEOUTS, type LockTimeout, type PinCheck } from './pin-store.ts';

type Step =
  | { readonly kind: 'current'; readonly verify: (pin: string) => Promise<PinCheck> }
  | { readonly kind: 'new' }
  | { readonly kind: 'confirm'; readonly chosen: string };

const PROMPT: Readonly<Record<Step['kind'], () => string>> = {
  current: m.security_lock_step_current,
  new: m.security_lock_step_new,
  confirm: m.security_lock_step_confirm,
};

/**
 * Asks for the current PIN when `verify` is given, then (with `choose`) for a new PIN twice, and hands the last PIN to
 * `onSubmit`.
 */
function PinDialog({
  title,
  verify,
  choose,
  onSubmit,
  onClose,
}: {
  title: string;
  verify?: (pin: string) => Promise<PinCheck>;
  choose: boolean;
  onSubmit: (pin: string) => Promise<void>;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>(verify === undefined ? { kind: 'new' } : { kind: 'current', verify });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (pin: string) => {
    try {
      await onSubmit(pin);
      onClose();
    } catch {
      setError(m.security_lock_save_failed());
    }
  };

  const enter = async (pin: string) => {
    setError(null);
    if (step.kind === 'new') {
      setStep({ kind: 'confirm', chosen: pin });
      return;
    }
    if (step.kind === 'confirm' && step.chosen !== pin) {
      setStep({ kind: 'new' });
      setError(m.security_lock_mismatch());
      return;
    }
    setPending(true);
    const check = step.kind === 'current' ? await step.verify(pin) : { ok: true as const };
    if (!check.ok) setError(m.app_lock_wrong({ count: check.remaining }));
    else if (step.kind === 'current' && choose) setStep({ kind: 'new' });
    else await submit(pin);
    setPending(false);
  };

  return (
    <Modal
      // Always open while mounted: any change closes it.
      open
      onOpenChange={onClose}
      title={title}
      description={m.security_lock_dialog_description()}
    >
      <p className="text-center text-[13px] font-medium">{PROMPT[step.kind]()}</p>
      <div role="alert" className="min-h-5 text-center text-[12.5px] text-red-fg">
        {error}
      </div>
      <PinPad
        // A new step starts with empty dots.
        key={step.kind}
        label={PROMPT[step.kind]()}
        disabled={pending}
        onComplete={(pin) => {
          void enter(pin);
        }}
      />
    </Modal>
  );
}

export function AppLockSettings() {
  const { pin, enable } = useAppLock();
  const [dialog, setDialog] = useState<'enable' | 'change' | 'disable' | null>(null);
  const timeoutId = useId();
  const close = () => {
    setDialog(null);
  };

  return (
    <>
      <SettingsRow title={m.security_lock_title()} description={m.security_lock_description()}>
        <Switch
          label={<span className="sr-only">{m.security_lock_title()}</span>}
          checked={pin !== null}
          onChange={(event) => {
            setDialog(event.currentTarget.checked ? 'enable' : 'disable');
          }}
        />
      </SettingsRow>
      {pin === null ? (
        dialog === 'enable' ? (
          <PinDialog title={m.security_lock_enable_title()} choose onSubmit={enable} onClose={close} />
        ) : null
      ) : (
        <>
          <SettingsRow title={<label htmlFor={timeoutId}>{m.security_lock_timeout_title()}</label>}>
            <div className="w-40 shrink-0">
              <Select
                id={timeoutId}
                size="sm"
                value={pin.timeoutMinutes}
                onChange={(event) => {
                  pin.setTimeoutMinutes(Number(event.currentTarget.value) as LockTimeout);
                }}
              >
                {LOCK_TIMEOUTS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {m.security_lock_timeout_option({ minutes })}
                  </option>
                ))}
              </Select>
            </div>
          </SettingsRow>
          <SettingsRow title={m.security_lock_pin_title()} description={m.security_lock_pin_description()}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setDialog('change');
              }}
            >
              {m.security_lock_pin_change()}
            </Button>
          </SettingsRow>
          {dialog === 'change' ? (
            <PinDialog
              title={m.security_lock_change_title()}
              verify={pin.verify}
              choose
              onSubmit={pin.change}
              onClose={close}
            />
          ) : null}
          {dialog === 'disable' ? (
            <PinDialog
              title={m.security_lock_disable_title()}
              verify={pin.verify}
              choose={false}
              onSubmit={pin.remove}
              onClose={close}
            />
          ) : null}
        </>
      )}
    </>
  );
}
