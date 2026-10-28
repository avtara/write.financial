// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Aplikasi terkunci" (design `z6Ce7`, FR-A6): shown instead of the app, full screen, with the user's initials and
 * name, the keypad, and "Lupa PIN? Masuk dengan kata sandi". Focus starts on the screen and Tab stays inside it;
 * there is nothing to dismiss. A wrong PIN says how many attempts are left; after the last one the keypad is gone and
 * only signing in with the password remains.
 */
import { m } from '@wf/i18n/messages';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Viewer } from '../../server/gate.ts';
import { FormError } from '../form.tsx';
import { initials } from '../user-menu.tsx';
import { PinPad } from './pin-pad.tsx';
import type { LockTimeout, PinCheck } from './pin-store.ts';

export interface LockScreenProps {
  viewer: Pick<Viewer, 'name' | 'email'>;
  timeoutMinutes: LockTimeout;
  /** Every attempt is used up: no keypad, only the password sign-in. */
  exhausted: boolean;
  /** Why signing out failed, if it did. */
  error: string | null;
  onUnlock: (pin: string) => Promise<PinCheck>;
  /** Removes this device's PIN and signs out to the sign-in page. */
  onForgot: () => void;
}

/** Keeps Tab and Shift+Tab on the screen's enabled buttons. */
function trapTab(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;
  const buttons = event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled)');
  const first = buttons.item(0);
  const last = buttons.item(buttons.length - 1);
  const active = document.activeElement;
  if (event.shiftKey ? active === first || active === event.currentTarget : active === last) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  }
}

export function LockScreen({ viewer, timeoutMinutes, exhausted, error, onUnlock, onForgot }: LockScreenProps) {
  const root = useRef<HTMLElement>(null);
  const [pending, setPending] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    root.current?.focus();
  }, []);

  const unlock = async (pin: string) => {
    setPending(true);
    const result = await onUnlock(pin);
    setPending(false);
    setRemaining(result.ok ? null : result.remaining);
  };

  return (
    <main
      ref={root}
      tabIndex={-1}
      aria-labelledby="app-lock-title"
      onKeyDown={trapTab}
      className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-bg px-6 py-10 text-fg outline-none"
    >
      <div className="flex flex-col items-center gap-2 text-center">
        <span
          aria-hidden="true"
          className="mb-1 inline-flex size-14 items-center justify-center rounded-full bg-surface-5 text-[18px] font-semibold"
        >
          {initials(viewer)}
        </span>
        <h1 id="app-lock-title" className="text-[17px] font-semibold">
          <span className="sr-only">{m.app_lock_title()} · </span>
          {viewer.name}
        </h1>
        <p className="text-[13px] text-muted-fg">{m.app_lock_subtitle({ minutes: timeoutMinutes })}</p>
      </div>
      <div role="alert" className="min-h-5 text-[13px] text-red-fg">
        {exhausted ? m.app_lock_exhausted() : remaining === null ? null : m.app_lock_wrong({ count: remaining })}
      </div>
      {exhausted ? null : (
        <PinPad
          label={m.app_lock_keypad_label()}
          disabled={pending}
          onComplete={(pin) => {
            void unlock(pin);
          }}
        />
      )}
      {error === null ? null : <FormError>{error}</FormError>}
      <button
        type="button"
        onClick={onForgot}
        className="rounded-[6px] text-[13px] font-medium text-muted-fg underline-offset-4 hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {m.app_lock_forgot()}
      </button>
    </main>
  );
}
