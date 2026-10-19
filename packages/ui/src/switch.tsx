// SPDX-License-Identifier: AGPL-3.0-only
import type { InputHTMLAttributes, ReactNode } from 'react';

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'> {
  label: ReactNode;
  /** A second, quieter line under the label ("Masuk ke kekayaan bersih dan laporan"). */
  description?: ReactNode;
}

/**
 * An on/off setting that applies at once (design "Hitung dalam total saldo": label left, switch right; on = `$fg`
 * track). A native checkbox with `role="switch"`, so Space toggles it, forms submit it, and every input prop works.
 */
export function Switch({ label, description, className = '', ...props }: SwitchProps) {
  return (
    <label
      className={`flex cursor-pointer items-center gap-3 has-disabled:cursor-default has-disabled:opacity-60 ${className}`}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] text-fg">{label}</span>
        {description === undefined ? null : <span className="text-[11.5px] text-subtle">{description}</span>}
      </span>
      <span className="relative flex h-5 w-9 shrink-0">
        <input
          type="checkbox"
          role="switch"
          {...props}
          className="peer h-5 w-9 cursor-[inherit] appearance-none rounded-full bg-surface-5 checked:bg-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-0.5 left-0.5 size-4 rounded-full bg-neutral-mid transition-transform peer-checked:translate-x-4 peer-checked:bg-bg"
        />
      </span>
    </label>
  );
}
