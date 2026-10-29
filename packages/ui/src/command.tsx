// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A searchable command list on cmdk (design "Popover — Pilih kategori", ⌘K): typing filters, ↑/↓ move the active
 * item, Enter picks it; groups have headings and an empty state. The input owns focus and points at the active item
 * with `aria-activedescendant` (`combobox` + `listbox` + `option`). Three ways to use it:
 * - the parts (`Command`, `CommandInput`, `CommandList`, `CommandGroup`, `CommandItem`, …) for custom layouts;
 * - `CommandDialog` for a modal palette (⌘K);
 * - `Combobox` for a popover picker from data (category, account).
 */
import { Command as Cmdk, defaultFilter } from 'cmdk';
import { Check, Search, type LucideIcon } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useRef, useState, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from './popover.tsx';

export type CommandProps = ComponentProps<typeof Cmdk>;

export function Command({ className = '', ...props }: CommandProps) {
  return <Cmdk className={`flex flex-col text-fg ${className}`} {...props} />;
}

export interface CommandInputProps extends ComponentProps<typeof Cmdk.Input> {
  /** At the end of the field, e.g. `<KbdHint keys={['Esc']} />`. */
  hint?: ReactNode;
}

export function CommandInput({ hint, className = '', ...props }: CommandInputProps) {
  return (
    <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-[11px]">
      <Search aria-hidden="true" className="size-3.5 shrink-0 text-subtle" />
      <Cmdk.Input
        className={`min-w-0 flex-1 bg-transparent text-[13.5px] text-fg outline-none placeholder:text-subtle ${className}`}
        {...props}
      />
      {hint}
    </div>
  );
}

export interface CommandListProps extends ComponentProps<typeof Cmdk.List> {
  /** Names the results for assistive technology (cmdk's default is the English "Suggestions"). */
  label: string;
}

export function CommandList({ className = '', ...props }: CommandListProps) {
  return <Cmdk.List className={`max-h-[360px] overflow-y-auto overscroll-contain p-1.5 ${className}`} {...props} />;
}

export function CommandEmpty({ className = '', ...props }: ComponentProps<typeof Cmdk.Empty>) {
  return <Cmdk.Empty className={`px-3 py-6 text-center text-[12.5px] text-muted-fg ${className}`} {...props} />;
}

export function CommandGroup({ className = '', ...props }: ComponentProps<typeof Cmdk.Group>) {
  return (
    <Cmdk.Group
      className={`[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-subtle [&_[cmdk-group-heading]]:uppercase ${className}`}
      {...props}
    />
  );
}

export function CommandSeparator({ className = '', ...props }: ComponentProps<typeof Cmdk.Separator>) {
  return <Cmdk.Separator className={`-mx-1.5 my-1.5 h-px bg-border ${className}`} {...props} />;
}

export interface CommandItemProps extends ComponentProps<typeof Cmdk.Item> {
  icon?: LucideIcon;
  /** A custom leading visual (an account logo) shown instead of `icon`. */
  media?: ReactNode;
  /** At the end of the row: a budget note, a balance (`<Money>`), or a shortcut (`<KbdHint>`). */
  aside?: ReactNode;
  /** Marks the current choice with a check. */
  selected?: boolean;
}

export function CommandItem({
  icon: Icon,
  media,
  aside,
  selected = false,
  className = '',
  children,
  ...props
}: CommandItemProps) {
  return (
    <Cmdk.Item
      className={`flex min-h-9 cursor-default items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-[13.5px] text-text-secondary outline-none select-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-surface-4 data-[selected=true]:text-fg ${className}`}
      {...props}
    >
      {media ?? (Icon === undefined ? null : <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-fg" />)}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {aside === undefined ? null : <span className="shrink-0 font-mono text-[11.5px] text-subtle">{aside}</span>}
      {selected ? <Check aria-hidden="true" className="size-3.5 shrink-0 text-violet" /> : null}
    </Cmdk.Item>
  );
}

/** A row under the list for actions that are not results ("Buat kategori pengeluaran") and keyboard hints. */
export function CommandFooter({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2 border-t border-border p-1.5">{children}</div>;
}

export interface CommandDialogProps extends Omit<CommandProps, 'label'> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names the dialog and the search field for assistive technology, e.g. "Cari atau jalankan perintah". */
  label: string;
}

/**
 * A modal command palette (⌘K, FR-S4) on Radix Dialog: focus starts in the search field, Escape closes, and focus
 * returns to whatever had it before.
 */
export function CommandDialog({ open, onOpenChange, label, children, ...props }: CommandDialogProps) {
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <Dialog.Content
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            opener.current = document.activeElement as HTMLElement | null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
          className="fixed top-[15vh] left-1/2 z-50 w-[600px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-[12px] border border-border-strong bg-popover shadow-[0_16px_48px_var(--shadow)]"
        >
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          <Command label={label} {...props}>
            {children}
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface ComboboxOption {
  value: string;
  label: string;
  /** Extra search terms, e.g. "makan" for "Makan & Dapur". */
  keywords?: readonly string[];
  icon?: LucideIcon;
  /** Shown instead of `icon`, e.g. an account logo. */
  media?: ReactNode;
  aside?: ReactNode;
  disabled?: boolean;
}

export interface ComboboxGroup {
  /** Group heading, e.g. "Kebutuhan"; omit for a flat list. */
  heading?: string;
  options: readonly ComboboxOption[];
}

export interface ComboboxProps {
  value: string | null;
  onValueChange: (value: string) => void;
  groups: readonly ComboboxGroup[];
  /** Names the search field and list, e.g. "Pilih kategori". */
  label: string;
  searchPlaceholder: string;
  /** Shown when nothing matches, e.g. "Kategori tidak ditemukan". */
  emptyLabel: string;
  /** Under the list; `close` dismisses the popover (e.g. before opening "Buat kategori"). */
  footer?: (close: () => void) => ReactNode;
  /** The element that opens the picker (a field-like button, a "Lainnya" tile); it must accept a ref and props. */
  children: ReactElement;
  /** Width class of the popover. Default `w-[412px]`. */
  contentClassName?: string;
}

/**
 * A picker from data (FR-T2 category and account popovers): a trigger that opens a searchable, grouped list in a
 * popover. Picking closes it and returns focus to the trigger.
 */
export function Combobox({
  value,
  onValueChange,
  groups,
  label,
  searchPlaceholder,
  emptyLabel,
  footer,
  children,
  contentClassName = 'w-[412px]',
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className={`max-w-[calc(100vw-16px)] ${contentClassName}`}>
        <Command
          label={label}
          // Match labels and keywords only, so values (ids) never match the search.
          filter={(_value, search, keywords) => defaultFilter('', search, keywords)}
          {...(value === null ? {} : { defaultValue: value })}
        >
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList label={label}>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            {groups.map((group, index) => (
              <CommandGroup
                key={group.heading ?? index}
                {...(group.heading === undefined ? {} : { heading: group.heading })}
              >
                {group.options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    keywords={[option.label, ...(option.keywords ?? [])]}
                    disabled={option.disabled ?? false}
                    selected={option.value === value}
                    {...(option.icon === undefined ? {} : { icon: option.icon })}
                    {...(option.media === undefined ? {} : { media: option.media })}
                    aside={option.aside}
                    onSelect={() => {
                      onValueChange(option.value);
                      close();
                    }}
                  >
                    {option.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          {footer === undefined ? null : <CommandFooter>{footer(close)}</CommandFooter>}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
