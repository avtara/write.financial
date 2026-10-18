// SPDX-License-Identifier: AGPL-3.0-only
import { Eye, EyeOff } from 'lucide-react';
import { useId, useState } from 'react';

export interface SecretInputProps {
  label: string;
  /**
   * Up to the last 4 characters of the stored secret, shown as a hint. There is deliberately no `value` or
   * `defaultValue`: stored secrets never go back to the browser (PRD §9.1), the field only collects a new one.
   */
  last4?: string;
  /** Receives the new secret as it is typed. */
  onChange: (value: string) => void;
  /** Accessible names of the reveal toggle. */
  showLabel: string;
  hideLabel: string;
  name?: string;
  disabled?: boolean;
}

/** Password-style field for API keys and tokens, with a show/hide toggle. Starts empty, always. */
export function SecretInput({
  label,
  last4,
  onChange,
  showLabel,
  hideLabel,
  name,
  disabled = false,
}: SecretInputProps) {
  const id = useId();
  const [revealed, setRevealed] = useState(false);
  const [value, setValue] = useState('');
  // Graphemes, so an emoji or accented character counts as one character.
  if (last4 !== undefined && [...new Intl.Segmenter().segment(last4)].length > 4) {
    throw new RangeError('SecretInput only accepts the last 4 characters of a stored secret');
  }
  const Icon = revealed ? EyeOff : Eye;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12.5px] font-medium text-text-secondary">
        {label}
      </label>
      <div className="flex h-8 items-center rounded-[6px] border border-border-input bg-input focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
        <input
          id={id}
          name={name}
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            onChange(event.target.value);
          }}
          placeholder={last4 === undefined ? undefined : `•••• ${last4}`}
          disabled={disabled}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent px-2.5 font-mono text-[13px] text-fg outline-none placeholder:text-subtle disabled:text-text-disabled"
        />
        <button
          type="button"
          aria-controls={id}
          aria-label={revealed ? hideLabel : showLabel}
          disabled={disabled}
          onClick={() => {
            setRevealed(!revealed);
          }}
          className="flex size-8 items-center justify-center rounded-[6px] text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring disabled:text-text-disabled"
        >
          <Icon aria-hidden="true" className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
