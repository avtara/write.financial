// SPDX-License-Identifier: AGPL-3.0-only
import { Check, ChevronsUpDown, type LucideIcon } from 'lucide-react';
import { Select as SelectPrimitive } from 'radix-ui';
import { POPOVER_SURFACE } from './popover.tsx';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  /** A second, quieter line, e.g. "sheet per bulan". */
  description?: string;
  icon?: LucideIcon;
  disabled?: boolean;
}

export interface SelectProps<T extends string> {
  /** `null` shows the placeholder. */
  value: T | null;
  onValueChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  placeholder: string;
  /** `lg` 42 px (wizard, dialogs), `sm` 32 px (settings rows, filters); the same sizes as the text inputs. */
  size?: 'lg' | 'sm';
  /** From a `Field` (`id`, `aria-describedby`, `aria-invalid`), or `aria-label` when there is no visible label. */
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string | undefined;
  'aria-invalid'?: boolean;
  /** Submitted with a surrounding `<form>`. */
  name?: string;
  disabled?: boolean;
  required?: boolean;
}

const TRIGGER: Readonly<Record<'lg' | 'sm', string>> = {
  lg: 'h-[42px] rounded-[9px] px-3 text-[14px]',
  sm: 'h-8 rounded-[7px] px-2.5 text-[12.5px]',
};

/**
 * A single choice from a list too long for a `SegmentedControl`, on Radix Select (`combobox` + `listbox`): opens with
 * Enter, Space or the arrow keys, typing jumps to an option, Escape closes. Styled like the text inputs.
 */
export function Select<T extends string>({
  value,
  onValueChange,
  options,
  placeholder,
  size = 'lg',
  id,
  'aria-label': ariaLabel,
  'aria-describedby': describedBy,
  'aria-invalid': invalid = false,
  name,
  disabled = false,
  required = false,
}: SelectProps<T>) {
  return (
    <SelectPrimitive.Root
      // Radix shows the placeholder for an empty value.
      value={value ?? ''}
      onValueChange={(next) => {
        // Radix reports the `value` of one of `options`, so it is always a `T`.
        onValueChange(next as T);
      }}
      disabled={disabled}
      required={required}
      {...(name === undefined ? {} : { name })}
    >
      <SelectPrimitive.Trigger
        {...(id === undefined ? {} : { id })}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        className={`flex w-full min-w-0 items-center gap-2 border border-border-input bg-input text-left text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:text-text-disabled aria-invalid:border-red data-[placeholder]:text-subtle ${TRIGGER[size]}`}
      >
        <span className="min-w-0 flex-1 truncate">
          <SelectPrimitive.Value placeholder={placeholder} />
        </span>
        <SelectPrimitive.Icon>
          <ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 text-subtle" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          collisionPadding={8}
          className={`${POPOVER_SURFACE} max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)]`}
        >
          <SelectPrimitive.Viewport className="p-1.5">
            {options.map(({ value: option, label, description, icon: Icon, disabled: optionDisabled = false }) => (
              <SelectPrimitive.Item
                key={option}
                value={option}
                disabled={optionDisabled}
                className="flex min-h-8 cursor-default items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-[13px] text-text-secondary outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted data-[highlighted]:text-fg"
              >
                {Icon === undefined ? null : <Icon aria-hidden="true" className="size-3.5 shrink-0" />}
                <span className="flex min-w-0 flex-1 flex-col">
                  <SelectPrimitive.ItemText>{label}</SelectPrimitive.ItemText>
                  {description === undefined ? null : <span className="text-[11.5px] text-subtle">{description}</span>}
                </span>
                <SelectPrimitive.ItemIndicator>
                  <Check aria-hidden="true" className="size-3.5 text-fg" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
