// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The "Warna" row of the category form (design `zGTve`, `h4zLb8`): the palette as native radios (one Tab stop, arrow
 * keys choose) and a "Warna lain" swatch that opens a popover with the system color picker and a `#` hex field.
 */
import { m } from '@wf/i18n/messages';
import { Popover, PopoverContent, PopoverTrigger } from '@wf/ui/popover';
import { Plus } from 'lucide-react';
import { useId, useState } from 'react';
import { colorProps, HEX_COLOR, PALETTE_COLORS, type ColorToken } from '../lib/colors.ts';
import { Button, TextInput } from './form.tsx';

const COLOR_NAMES: Readonly<Record<ColorToken, () => string>> = {
  amber: m.color_amber,
  blue: m.color_blue,
  cyan: m.color_cyan,
  green: m.color_green,
  orange: m.color_orange,
  red: m.color_red,
  rose: m.color_rose,
  violet: m.color_violet,
  yellow: m.color_yellow,
  subtle: m.color_subtle,
};

const SWATCH = 'size-[22px] rounded-full bg-[var(--wf-color,var(--subtle))]';

export interface ColorPickerProps {
  /** A token or `#rrggbb`. */
  readonly value: string;
  readonly onValueChange: (color: string) => void;
  readonly label: string;
}

function CustomColor({ value, onValueChange }: Pick<ColorPickerProps, 'value' | 'onValueChange'>) {
  const [open, setOpen] = useState(false);
  const custom = HEX_COLOR.test(value);
  const [draft, setDraft] = useState('');
  const hexId = useId();
  const typed = `#${draft.replace(/^#/, '')}`;
  const valid = HEX_COLOR.test(typed);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft((custom ? value : '#14b8a6').slice(1).toUpperCase());
        setOpen(next);
      }}
    >
      <PopoverTrigger
        aria-label={custom ? m.color_custom_current({ hex: value.toUpperCase() }) : m.color_custom()}
        aria-pressed={custom}
        className="flex size-[30px] items-center justify-center rounded-full border-2 border-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:border-fg"
      >
        {custom ? (
          <span {...colorProps(value)} className={SWATCH} />
        ) : (
          <span className="flex size-[22px] items-center justify-center rounded-full bg-[conic-gradient(var(--red),var(--yellow),var(--green),var(--cyan),var(--blue),var(--violet),var(--rose),var(--red))] text-on-accent">
            <Plus aria-hidden="true" className="size-3" />
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className="flex w-[236px] flex-col gap-3 p-3" aria-label={m.color_custom()}>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={m.color_system_picker()}
            value={valid ? typed.toLowerCase() : '#000000'}
            onChange={(event) => {
              setDraft(event.target.value.slice(1).toUpperCase());
            }}
            className="size-8 shrink-0 cursor-pointer rounded-full border border-border-input bg-transparent p-0"
          />
          <label htmlFor={hexId} className="sr-only">
            {m.color_hex()}
          </label>
          <div className="relative flex-1">
            <span
              aria-hidden="true"
              className="absolute top-1/2 left-2.5 -translate-y-1/2 font-mono text-[12.5px] text-subtle"
            >
              #
            </span>
            <TextInput
              id={hexId}
              size="sm"
              value={draft}
              maxLength={7}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={!valid}
              onChange={(event) => {
                setDraft(event.target.value.replace(/^#/, '').toUpperCase());
              }}
              className="pl-6 font-mono"
            />
          </div>
        </div>
        <div className="flex gap-2 *:flex-1">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setOpen(false);
            }}
          >
            {m.color_cancel()}
          </Button>
          <Button
            size="sm"
            disabled={!valid}
            onClick={() => {
              onValueChange(typed.toLowerCase());
              setOpen(false);
            }}
          >
            {m.color_apply()}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ColorPicker({ value, onValueChange, label }: ColorPickerProps) {
  const name = useId();
  return (
    <fieldset className="flex min-w-0 flex-col">
      <legend className="pb-1.5 text-[12.5px] font-medium text-muted-fg">{label}</legend>
      <div className="flex flex-wrap items-center gap-1.5">
        {PALETTE_COLORS.map((color) => (
          <label
            key={color}
            className="relative flex size-[30px] cursor-pointer items-center justify-center rounded-full border-2 border-transparent has-checked:border-fg has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
          >
            <input
              type="radio"
              name={name}
              value={color}
              checked={value === color}
              onChange={() => {
                onValueChange(color);
              }}
              aria-label={COLOR_NAMES[color]()}
              className="absolute inset-0 z-10 cursor-pointer appearance-none rounded-[inherit] opacity-0"
            />
            <span {...colorProps(color)} aria-hidden="true" className={SWATCH} />
          </label>
        ))}
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
        <CustomColor value={value} onValueChange={onValueChange} />
      </div>
    </fieldset>
  );
}
