// SPDX-License-Identifier: AGPL-3.0-only
import type { LucideIcon } from 'lucide-react';
import { RadioGroup } from 'radix-ui';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  /** Names the group for assistive technology, e.g. "Rentang waktu". */
  label: string;
  /** Segments share the full width equally. */
  fill?: boolean;
  className?: string;
}

/**
 * One choice out of a few, shown side by side (design "Period Toggle": Minggu · Bulan · Tahun). A radio group on
 * Radix RadioGroup: one Tab stop, arrow keys move and choose. Use `Tabs` instead when each choice shows its own panel.
 */
export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  label,
  fill = false,
  className = '',
}: SegmentedControlProps<T>) {
  return (
    <RadioGroup.Root
      value={value}
      onValueChange={(next) => {
        // Radix reports the `value` of one of `options`, so it is always a `T`.
        onValueChange(next as T);
      }}
      aria-label={label}
      orientation="horizontal"
      className={`gap-0.5 rounded-[8px] border border-border bg-card p-[3px] ${fill ? 'flex w-full *:flex-1' : 'inline-flex'} ${className}`}
    >
      {options.map(({ value: option, label: optionLabel, icon: Icon, disabled = false }) => (
        <RadioGroup.Item
          key={option}
          value={option}
          disabled={disabled}
          className="inline-flex items-center justify-center gap-1.5 rounded-[6px] px-3 py-[5px] text-[12.5px] text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 data-[state=checked]:bg-muted data-[state=checked]:font-medium data-[state=checked]:text-fg"
        >
          {Icon === undefined ? null : <Icon aria-hidden="true" className="size-3.5 shrink-0" />}
          {optionLabel}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
