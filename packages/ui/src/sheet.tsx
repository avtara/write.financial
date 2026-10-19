// SPDX-License-Identifier: AGPL-3.0-only
import { X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useRef, type ReactNode } from 'react';

export interface SheetProps {
  /** Controlled: to keep a filled form open (FR-T9 "Buang / Simpan draf / Lanjut mengisi"), ignore the close. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Accessible name of the × button, e.g. "Tutup". */
  closeLabel: string;
  /** Pinned under the scrolling body: actions such as "Batal" / "Simpan". */
  footer?: ReactNode;
  /** `md` 460 px (Record Transaction, detail panels), `lg` 560 px. */
  size?: 'md' | 'lg';
  children: ReactNode;
}

/**
 * A panel sliding in from the right (design "Catat Transaksi (Sheet)": `$card` fill, header 17/600 with a subtitle,
 * pinned footer). Used for Record Transaction and, below 1280 px, for detail panels (plan §7). Built on Radix Dialog:
 * modal, focus is trapped inside, Escape and the × close it, and focus returns to whatever opened it. Content unmounts
 * on close. Radix adds a scroll-lock `<style>`; the app hands it the CSP nonce (`setNonce`).
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  footer,
  size = 'md',
  children,
}: SheetProps) {
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim motion-safe:animate-[wf-fade-in_150ms_ease-out]" />
        <Dialog.Content
          {...(description === undefined ? { 'aria-describedby': undefined } : {})}
          onOpenAutoFocus={() => {
            // Radix restores focus only to a `Dialog.Trigger`; sheets are opened by the caller (a button, `N`).
            opener.current = document.activeElement as HTMLElement | null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
          className={`fixed inset-y-0 right-0 z-50 flex max-w-full flex-col border-l border-border bg-card text-fg shadow-[-12px_0_40px_var(--shadow)] motion-safe:animate-[wf-sheet-in_200ms_ease-out] ${size === 'md' ? 'w-[460px]' : 'w-[560px]'}`}
        >
          <header className="flex flex-col gap-[3px] border-b border-border py-5 pr-16 pl-6">
            <Dialog.Title className="text-[17px] font-semibold">{title}</Dialog.Title>
            {description === undefined ? null : (
              <Dialog.Description className="text-[12.5px] text-muted-fg">{description}</Dialog.Description>
            )}
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">{children}</div>
          {footer === undefined ? null : (
            <footer className="flex items-center gap-2 border-t border-border px-6 py-4">{footer}</footer>
          )}
          {/* Last in the tab order, so opening the sheet focuses its first field, not the × (keyboard-first entry). */}
          <Dialog.Close
            aria-label={closeLabel}
            className="absolute top-5 right-6 flex size-7 items-center justify-center rounded-[7px] border border-border text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X aria-hidden="true" className="size-[13px]" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
