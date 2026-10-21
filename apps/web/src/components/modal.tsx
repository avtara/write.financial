// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A modal dialog (design "Dialog": `$dialog` fill, r14) on Radix Dialog: focus is trapped inside, Escape closes it,
 * and focus returns to whatever opened it. Its content unmounts on close, so forms inside start fresh every time.
 * Radix adds a scroll-lock `<style>`; the router hands it the CSP nonce (`setNonce` in `router.tsx`).
 */
import { Dialog } from 'radix-ui';
import { useRef, type ReactNode } from 'react';

const WIDTH = { md: 'w-[420px]', lg: 'w-[460px]', xl: 'w-[560px]' } as const;

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** A sentence; may hold `<Money>` amounts. */
  description?: ReactNode;
  /** For content that shows its own heading (`TotpEnrollment`): the title is only announced. */
  hideTitle?: boolean;
  /** `md` 420 px (forms), `lg` 460 px (authenticator setup), `xl` 560 px (account form, reconciliation). */
  size?: 'md' | 'lg' | 'xl';
  children: ReactNode;
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  hideTitle = false,
  size = 'md',
  children,
}: ModalProps) {
  const opener = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <Dialog.Content
          {...(description === undefined ? { 'aria-describedby': undefined } : {})}
          onOpenAutoFocus={() => {
            // Radix restores focus only to a `Dialog.Trigger`; these dialogs are opened by the caller.
            opener.current = document.activeElement as HTMLElement | null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
          className={`fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-32px)] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-[14px] border border-border-dialog bg-dialog p-6 text-fg shadow-[0_16px_48px_var(--shadow)] ${WIDTH[size]}`}
        >
          <div className={hideTitle ? 'sr-only' : 'flex flex-col gap-1'}>
            <Dialog.Title className="text-[16px] font-semibold">{title}</Dialog.Title>
            {description === undefined ? null : (
              <Dialog.Description className="text-[13px] text-muted-fg">{description}</Dialog.Description>
            )}
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
