// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tabs on Radix Tabs (`tablist`/`tab`/`tabpanel`): arrow keys move between tabs and activate them, Home/End jump to
 * the first and last. The list looks like the design's segmented "Type Toggle" (Pengeluaran · Pemasukan · Transfer):
 * a sunken track with the active tab raised. Compose `<Tabs value onValueChange><TabsList label>…<TabsTrigger>…
 * </TabsList><TabsContent>…</TabsContent></Tabs>`.
 */
import type { LucideIcon } from 'lucide-react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

export const Tabs = TabsPrimitive.Root;

export interface TabsListProps extends Omit<ComponentProps<typeof TabsPrimitive.List>, 'aria-label'> {
  /** Names the tab list for assistive technology, e.g. "Jenis transaksi". */
  label: string;
  /** Tabs share the full width equally (the Record Transaction sheet). */
  fill?: boolean;
}

export function TabsList({ label, fill = false, className = '', ...props }: TabsListProps) {
  return (
    <TabsPrimitive.List
      aria-label={label}
      className={`gap-0.5 rounded-[8px] border border-border bg-input p-[3px] outline-none ${fill ? 'flex w-full *:flex-1' : 'inline-flex'} ${className}`}
      {...props}
    />
  );
}

export interface TabsTriggerProps extends ComponentProps<typeof TabsPrimitive.Trigger> {
  icon?: LucideIcon;
  /** Extra icon classes; target the active tab with `group-data-[state=active]:` (`…:text-red` for Pengeluaran). */
  iconClassName?: string;
  /**
   * `false` for tabs that switch something in place without a `TabsContent` (a transaction type, a table's
   * view): the tab then points to no panel, since an `aria-controls` naming a missing element is invalid ARIA.
   */
  panel?: boolean;
}
export function TabsTrigger({
  icon: Icon,
  iconClassName = '',
  className = '',
  panel = true,
  children,
  ...props
}: TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      className={`group inline-flex items-center justify-center gap-1.5 rounded-[6px] px-2.5 py-[7px] text-[13px] text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring data-[state=active]:bg-muted data-[state=active]:font-medium data-[state=active]:text-fg ${className}`}
      {...props}
      // After the props: Radix sets `aria-controls` to the panel's id before spreading what it is given.
      {...(panel ? {} : { 'aria-controls': undefined })}
    >
      {Icon === undefined ? null : (
        <Icon aria-hidden="true" className={`size-3.5 shrink-0 text-subtle ${iconClassName}`} />
      )}
      {children}
    </TabsPrimitive.Trigger>
  );
}

export function TabsContent({ className = '', ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={`focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${className}`}
      {...props}
    />
  );
}
