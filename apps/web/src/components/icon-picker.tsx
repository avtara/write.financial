// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The "Ikon" grid of the category form (design `zGTve`): one native radio per glyph, so Tab enters the group once
 * and the arrow keys choose. The chosen cell takes the category's color.
 */
import { useId } from 'react';
import { colorProps } from '../lib/colors.ts';
import { CATEGORY_ICONS } from './category-icon.tsx';

export interface IconPickerProps {
  readonly value: string;
  readonly onValueChange: (icon: string) => void;
  /** Tints the chosen cell (token or `#rrggbb`). */
  readonly color: string;
  readonly label: string;
}

export function IconPicker({ value, onValueChange, color, label }: IconPickerProps) {
  const name = useId();
  return (
    <fieldset {...colorProps(color)} className="flex min-w-0 flex-col gap-1.5">
      <legend className="pb-1.5 text-[12.5px] font-medium text-muted-fg">{label}</legend>
      <div className="grid max-h-[172px] grid-cols-6 gap-2 overflow-y-auto p-0.5">
        {Object.entries(CATEGORY_ICONS).map(([icon, { glyph: Glyph, label: iconLabel }]) => (
          <label
            key={icon}
            className="relative flex h-9 cursor-pointer items-center justify-center rounded-[8px] border border-border text-muted-fg hover:bg-muted hover:text-fg has-checked:border-[var(--wf-color,var(--subtle))] has-checked:bg-[color-mix(in_srgb,var(--wf-color,var(--subtle))_14%,transparent)] has-checked:text-[var(--wf-color,var(--subtle))] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
          >
            <input
              type="radio"
              name={name}
              value={icon}
              checked={value === icon}
              onChange={() => {
                onValueChange(icon);
              }}
              aria-label={iconLabel()}
              className="absolute inset-0 z-10 cursor-pointer appearance-none rounded-[inherit] opacity-0"
            />
            <Glyph aria-hidden="true" className="size-4" />
          </label>
        ))}
      </div>
    </fieldset>
  );
}
