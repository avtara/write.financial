// SPDX-License-Identifier: AGPL-3.0-only
import { useRef, useState, type KeyboardEvent } from 'react';

export interface CodeInputProps {
  /** Accessible name of the group, e.g. "Kode verifikasi". */
  label: string;
  /** Accessible name of one box, e.g. `(2, 6) => "Digit 2 dari 6"`. */
  digitLabel: (position: number, length: number) => string;
  length?: number;
  /** Receives the entered digits after every change (empty boxes are skipped). */
  onChange: (code: string) => void;
  /** Called once every box holds a digit. */
  onComplete?: (code: string) => void;
  invalid?: boolean;
  disabled?: boolean;
}

/**
 * One-time code entry (2FA, design "6-digit code input"): one box per digit, digits only, auto-advance,
 * Backspace steps back, ←/→ move, and pasting or autofilling a whole code (`autocomplete="one-time-code"`)
 * fills every box. Each box selects its content on focus, so typing replaces the digit.
 */
export function CodeInput({
  label,
  digitLabel,
  length = 6,
  onChange,
  onComplete,
  invalid = false,
  disabled = false,
}: CodeInputProps) {
  const [digits, setDigits] = useState<readonly string[]>(() => Array.from({ length }, () => ''));
  const boxes = useRef<(HTMLInputElement | null)[]>([]);
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError(`CodeInput length must be a positive integer, got ${String(length)}`);
  }

  const update = (next: readonly string[], focus: number): void => {
    setDigits(next);
    const code = next.join('');
    onChange(code);
    if (code.length === length) onComplete?.(code);
    boxes.current[Math.min(focus, length - 1)]?.focus();
  };

  /** Writes the digits of `text` from `index` on; a whole code always starts at the first box. */
  const fill = (index: number, text: string): void => {
    const incoming = text.match(/\d/g) ?? [];
    if (incoming.length === 0) return;
    const start = incoming.length >= length ? 0 : index;
    const next = [...digits];
    const written = incoming.slice(0, length - start);
    written.forEach((digit, offset) => {
      next[start + offset] = digit;
    });
    update(next, start + written.length);
  };

  const clear = (index: number): void => {
    update(
      digits.map((digit, i) => (i === index ? '' : digit)),
      index,
    );
  };

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (digits[index] !== '') clear(index);
      else if (index > 0) clear(index - 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      boxes.current[Math.max(0, Math.min(index + (event.key === 'ArrowLeft' ? -1 : 1), length - 1))]?.focus();
    }
  };

  return (
    <div role="group" aria-label={label} className="flex gap-2">
      {digits.map((digit, index) => (
        <input
          // The boxes are positional and never reorder.
          key={index}
          ref={(element) => {
            boxes.current[index] = element;
          }}
          value={digit}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          aria-label={digitLabel(index + 1, length)}
          aria-invalid={invalid}
          disabled={disabled}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          onChange={(event) => {
            if (event.target.value === '') clear(index);
            else fill(index, event.target.value);
          }}
          onPaste={(event) => {
            event.preventDefault();
            fill(index, event.clipboardData.getData('text'));
          }}
          onKeyDown={(event) => {
            onKeyDown(index, event);
          }}
          className="size-10 rounded-[6px] border border-border-input bg-input text-center font-mono text-[17px] text-fg caret-ring outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-red disabled:text-text-disabled"
        />
      ))}
    </div>
  );
}
