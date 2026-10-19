// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dropdown menu (design "Menu Item": 32 px rows, r6) on Radix DropdownMenu: arrow keys move between items, typing
 * jumps to an item, Enter/Space select, Escape closes and returns focus to the trigger. Items can show the keyboard
 * shortcut that runs the same action. Compose `<DropdownMenu><DropdownMenuTrigger asChild>…</DropdownMenuTrigger>
 * <DropdownMenuContent>…</DropdownMenuContent></DropdownMenu>`.
 */
import { Check, type LucideIcon } from 'lucide-react';
import { DropdownMenu as MenuPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { KbdHint, type KbdKey, type Platform } from './kbd-hint.tsx';
import { POPOVER_SURFACE } from './popover.tsx';

const ROW =
  'flex h-8 cursor-default items-center gap-2.5 rounded-[6px] px-2 text-[13px] outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted';
/** Text color is separate from {@link ROW}: two color utilities on one element would be resolved by CSS order. */
const TONE = {
  default: 'text-text-secondary data-[highlighted]:text-fg',
  destructive: 'text-red-fg',
} as const;
const ITEM = `${ROW} ${TONE.default}`;

/** Non-modal by default: the page stays scrollable and Radix injects no scroll-lock `<style>`. */
export function DropdownMenu({ modal = false, ...props }: ComponentProps<typeof MenuPrimitive.Root>) {
  return <MenuPrimitive.Root modal={modal} {...props} />;
}

export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;

export function DropdownMenuContent({
  className = '',
  align = 'start',
  sideOffset = 8,
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={`${POPOVER_SURFACE} min-w-[200px] ${className}`}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

/** A padded block of items; separate blocks with {@link DropdownMenuSeparator}. */
export function DropdownMenuGroup({ className = '', ...props }: ComponentProps<typeof MenuPrimitive.Group>) {
  return <MenuPrimitive.Group className={`p-1.5 ${className}`} {...props} />;
}

export function DropdownMenuLabel({ className = '', ...props }: ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      className={`px-2 pt-1.5 pb-1 text-[11px] font-medium text-subtle uppercase ${className}`}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className = '', ...props }: ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={`h-px bg-border ${className}`} {...props} />;
}

export interface DropdownMenuItemProps extends ComponentProps<typeof MenuPrimitive.Item> {
  icon?: LucideIcon;
  /** The shortcut that runs the same action anywhere, shown at the end of the row (`⌘ ,`). */
  shortcut?: { keys: readonly KbdKey[]; platform: Platform };
  /** `destructive` for sign-out and delete. */
  variant?: 'default' | 'destructive';
}

export function DropdownMenuItem({
  icon: Icon,
  shortcut,
  variant = 'default',
  className = '',
  children,
  ...props
}: DropdownMenuItemProps) {
  return (
    <MenuPrimitive.Item className={`${ROW} ${TONE[variant]} ${className}`} {...props}>
      {Icon === undefined ? null : <Icon aria-hidden="true" className="size-3.5 shrink-0" />}
      <span className="flex-1">{children}</span>
      {shortcut === undefined ? null : <KbdHint keys={shortcut.keys} platform={shortcut.platform} />}
    </MenuPrimitive.Item>
  );
}

export interface DropdownMenuCheckboxItemProps extends ComponentProps<typeof MenuPrimitive.CheckboxItem> {
  /** `switch` draws an on/off switch for settings such as "Sembunyikan saldo"; `check` a check mark. */
  indicator?: 'check' | 'switch';
  children: ReactNode;
}

export function DropdownMenuCheckboxItem({
  indicator = 'check',
  checked = false,
  className = '',
  children,
  ...props
}: DropdownMenuCheckboxItemProps) {
  return (
    <MenuPrimitive.CheckboxItem checked={checked} className={`${ITEM} ${className}`} {...props}>
      <span className="flex-1">{children}</span>
      {indicator === 'switch' ? (
        <span
          aria-hidden="true"
          className={`flex h-4 w-7 items-center rounded-full p-0.5 ${checked === true ? 'justify-end bg-fg' : 'justify-start bg-surface-5'}`}
        >
          <span className="size-3 rounded-full bg-bg" />
        </span>
      ) : (
        <MenuPrimitive.ItemIndicator>
          <Check aria-hidden="true" className="size-3.5 text-fg" />
        </MenuPrimitive.ItemIndicator>
      )}
    </MenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className = '',
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.RadioItem>) {
  return (
    <MenuPrimitive.RadioItem className={`${ITEM} ${className}`} {...props}>
      <span className="flex-1">{children}</span>
      <MenuPrimitive.ItemIndicator>
        <Check aria-hidden="true" className="size-3.5 text-fg" />
      </MenuPrimitive.ItemIndicator>
    </MenuPrimitive.RadioItem>
  );
}
