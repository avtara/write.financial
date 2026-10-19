// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Popover (design "Popover pilihan": `$popover` fill, `$border-strong` stroke, r10) on Radix Popover: it opens from
 * its trigger, moves focus inside, closes on Escape or an outside click, and returns focus to the trigger.
 * Compose `<Popover><PopoverTrigger asChild>…</PopoverTrigger><PopoverContent>…</PopoverContent></Popover>`.
 */
import { Popover as PopoverPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

/** The surface shared by popovers, menus, selects, and comboboxes. */
export const POPOVER_SURFACE =
  'z-50 overflow-hidden rounded-[10px] border border-border-strong bg-popover text-fg shadow-[0_16px_40px_var(--shadow)]';

export type PopoverContentProps = ComponentProps<typeof PopoverPrimitive.Content>;

/** Portalled content, 6 px from the trigger and start-aligned unless told otherwise. */
export function PopoverContent({ className = '', align = 'start', sideOffset = 6, ...props }: PopoverContentProps) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={`${POPOVER_SURFACE} ${className}`}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
