// SPDX-License-Identifier: AGPL-3.0-only
import { Check } from 'lucide-react';
import type { InputHTMLAttributes, ReactNode } from 'react';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  /** A second, quieter line under the label. */
  description?: ReactNode;
}

/**
 * A labelled checkbox (design "Kolom" checklist: `$fg` fill with a dark check when on, `$border-input` box when off).
 * A native `<input type="checkbox">`, so it works in forms and with every input prop (`name`, `checked`, `onChange`,
 * `required`, `disabled`); clicking the label toggles it.
 */
export function Checkbox({ label, description, className = '', ...props }: CheckboxProps) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-2 text-[13px] text-text-secondary has-disabled:cursor-default has-disabled:opacity-60 ${className}`}
    >
      <span className="relative mt-0.5 flex size-4 shrink-0">
        <input
          type="checkbox"
          {...props}
          className="peer size-4 cursor-[inherit] appearance-none rounded-[4px] border border-border-input bg-input checked:border-fg checked:bg-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        <Check
          aria-hidden="true"
          strokeWidth={3}
          className="pointer-events-none absolute inset-0 m-auto size-3 text-primary-fg opacity-0 peer-checked:opacity-100"
        />
      </span>
      <span className="flex flex-col gap-0.5">
        <span>{label}</span>
        {description === undefined ? null : <span className="text-[11.5px] text-subtle">{description}</span>}
      </span>
    </label>
  );
}
