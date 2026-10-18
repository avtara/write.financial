// SPDX-License-Identifier: AGPL-3.0-only
/**
 * New-password input with the design's strength meter (FR-A1, design `zPHkt`: "Min. 10 karakter · kuat" and four
 * bars). The meter is a nudge, not a rule: the server enforces the minimum length and refuses breached passwords.
 */
import { m } from '@wf/i18n/messages';
import { Eye, EyeOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Field, TextInput, type ControlSize } from './form.tsx';

/** FR-A1; the server's `MIN_PASSWORD_LENGTH`. */
export const MIN_PASSWORD_LENGTH = 10;

/** 0 = too short, 1 weak, 2 fair, 3 strong, 4 very strong. */
export type Strength = 0 | 1 | 2 | 3 | 4;

/**
 * Length and variety: below the minimum is 0; otherwise one point per character class beyond the first (lower,
 * upper, digit, symbol) and one for 14+ characters, capped at 4.
 */
export function passwordStrength(password: string): Strength {
  // `length` in UTF-16 units, as the server counts it for the minimum.
  if (password.length < MIN_PASSWORD_LENGTH) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length;
  const score = 1 + Math.max(0, classes - 1) + (password.length >= 14 ? 1 : 0);
  return Math.min(4, score) as Strength;
}

const LABEL: Readonly<Record<Strength, () => string>> = {
  0: m.password_strength_short,
  1: m.password_strength_weak,
  2: m.password_strength_fair,
  3: m.password_strength_strong,
  4: m.password_strength_very_strong,
};

const BAR: Readonly<Record<Strength, string>> = {
  0: 'bg-red',
  1: 'bg-red',
  2: 'bg-amber',
  3: 'bg-green',
  4: 'bg-green',
};

export function PasswordStrength({ password }: { password: string }) {
  const strength = passwordStrength(password);
  return (
    <div className="flex flex-col gap-1.5">
      <div aria-hidden="true" className="flex gap-1">
        {([1, 2, 3, 4] as const).map((step) => (
          <span
            key={step}
            className={`h-1 flex-1 rounded-[2px] ${password !== '' && strength >= step ? BAR[strength] : 'bg-surface-4'}`}
          />
        ))}
      </div>
      <span className="text-[12px] text-subtle" aria-live="polite">
        {password === ''
          ? m.password_min_length({ count: MIN_PASSWORD_LENGTH })
          : `${m.password_min_length({ count: MIN_PASSWORD_LENGTH })} · ${LABEL[strength]()}`}
      </span>
    </div>
  );
}

export interface PasswordInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** `new-password` shows the strength meter; `current-password` does not. */
  autoComplete: 'new-password' | 'current-password';
  name?: string;
  error?: string | null;
  size?: ControlSize;
  aside?: ReactNode;
  disabled?: boolean;
}

/** A password field with a show/hide toggle, and the strength meter for new passwords. */
export function PasswordInput({
  label,
  value,
  onChange,
  autoComplete,
  name,
  error = null,
  size = 'lg',
  aside,
  disabled = false,
}: PasswordInputProps) {
  const [revealed, setRevealed] = useState(false);
  const Icon = revealed ? EyeOff : Eye;
  return (
    <Field
      label={label}
      aside={aside}
      error={error}
      hint={autoComplete === 'new-password' ? <PasswordStrength password={value} /> : undefined}
    >
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          <TextInput
            id={id}
            name={name}
            type={revealed ? 'text' : 'password'}
            size={size}
            value={value}
            autoComplete={autoComplete}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            disabled={disabled}
            onChange={(event) => {
              onChange(event.target.value);
            }}
            className="pr-10"
          />
          <button
            type="button"
            aria-label={revealed ? m.password_hide() : m.password_show()}
            aria-pressed={revealed}
            onClick={() => {
              setRevealed(!revealed);
            }}
            className="absolute top-1/2 right-1.5 flex size-7 -translate-y-1/2 items-center justify-center rounded-[6px] text-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Icon aria-hidden="true" className="size-[15px]" />
          </button>
        </div>
      )}
    </Field>
  );
}
