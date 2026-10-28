// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PIN entry (design `z6Ce7`): a dot per digit and a keypad 1–9, 0 with large touch targets, plus the physical keyboard
 * (digits, Backspace; Enter or Space on a focused key presses it). The PIN never shows. Once the last digit is in,
 * `onComplete` receives the PIN and the dots empty again; the progress is announced to screen readers.
 */
import { m } from '@wf/i18n/messages';
import { Delete } from 'lucide-react';
import { useEffect, useEffectEvent, useState } from 'react';
import { PIN_LENGTH } from './pin-store.ts';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

const KEY =
  'flex size-16 items-center justify-center rounded-full text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60';

export function PinPad({
  label,
  onComplete,
  disabled = false,
}: {
  /** Names the keypad and says what to enter ("Masukkan PIN"). */
  label: string;
  onComplete: (pin: string) => void;
  disabled?: boolean;
}) {
  const [entered, setEntered] = useState('');

  const press = (digit: string) => {
    const next = entered + digit;
    setEntered(next.length === PIN_LENGTH ? '' : next);
    if (next.length === PIN_LENGTH) onComplete(next);
  };
  const erase = () => {
    setEntered(entered.slice(0, -1));
  };

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      press(event.key);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      erase();
    }
  });
  useEffect(() => {
    if (disabled) return;
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [disabled]);

  const key = (digit: string) => (
    <button
      key={digit}
      type="button"
      disabled={disabled}
      onClick={() => {
        press(digit);
      }}
      className={`${KEY} bg-surface-sunken text-[22px] font-medium hover:bg-muted`}
    >
      {digit}
    </button>
  );

  return (
    <div role="group" aria-label={label} className="flex flex-col items-center gap-7">
      <div aria-hidden="true" className="flex gap-3.5">
        {Array.from({ length: PIN_LENGTH }, (_, index) => (
          <span
            // The dots are positional and never reorder.
            key={index}
            className={`size-3 rounded-full border ${index < entered.length ? 'border-fg bg-fg' : 'border-border-strong'}`}
          />
        ))}
      </div>
      <p aria-live="polite" className="sr-only">
        {m.app_lock_digits_entered({ count: entered.length, length: PIN_LENGTH })}
      </p>
      <div className="grid grid-cols-3 gap-4">
        {DIGITS.map(key)}
        <span aria-hidden="true" />
        {key('0')}
        <button
          type="button"
          aria-label={m.app_lock_delete_digit()}
          disabled={disabled}
          onClick={erase}
          className={`${KEY} text-muted-fg hover:bg-muted hover:text-fg`}
        >
          <Delete aria-hidden="true" className="size-5" />
        </button>
      </div>
    </div>
  );
}
