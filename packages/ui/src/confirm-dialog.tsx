// SPDX-License-Identifier: AGPL-3.0-only
import { AlertDialog } from 'radix-ui';
import { useRef } from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  /** What the action will change, e.g. "Aktif di 2 perangkat lain · iPhone, MacBook". */
  impact?: string;
  confirmLabel: string;
  cancelLabel: string;
  /** `destructive` for actions that delete or sign out: a red confirm button and a red impact note. */
  variant?: 'default' | 'destructive';
  onConfirm: () => void;
}

const BUTTON =
  'inline-flex h-8 items-center justify-center rounded-[6px] px-3 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

const VARIANT = {
  default: { confirm: 'bg-fg text-primary-fg hover:bg-text-strong', impact: 'bg-amber-tint-2 text-amber-fg' },
  destructive: { confirm: 'bg-red text-on-accent hover:bg-red-fg', impact: 'bg-red-tint-2 text-red-fg' },
} as const;

/**
 * Confirmation for consequential actions (design "Alert Dialog", "Konfirmasi keluar"). Built on Radix
 * AlertDialog: focus is trapped inside, Escape and Cancel close it, focus starts on Cancel and returns to
 * the previously focused element on close. Controlled by the caller.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  impact,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  onConfirm,
}: ConfirmDialogProps) {
  const styles = VARIANT[variant];
  const opener = useRef<HTMLElement | null>(null);
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        {/* z-50 like every modal layer, so it also covers a dialog it was opened from (Settings). */}
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <AlertDialog.Content
          onOpenAutoFocus={() => {
            // Radix only restores focus to an `AlertDialog.Trigger`; this dialog is opened by the caller,
            // so remember whatever had focus (the opener) before Radix moves it to Cancel.
            opener.current = document.activeElement as HTMLElement | null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
          className="fixed top-1/2 left-1/2 z-50 flex w-[400px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-[8px] border border-border-dialog bg-dialog p-5 text-fg shadow-[0_16px_48px_var(--shadow)]"
        >
          <AlertDialog.Title className="text-[15px] font-semibold">{title}</AlertDialog.Title>
          {/* Impact is part of the description, so screen readers announce it with the dialog. */}
          <AlertDialog.Description asChild>
            <div className="flex flex-col gap-3">
              <p className="text-[13px] text-muted-fg">{description}</p>
              {impact === undefined ? null : (
                <p className={`rounded-[6px] px-3 py-2 text-[12.5px] ${styles.impact}`}>{impact}</p>
              )}
            </div>
          </AlertDialog.Description>
          <div className="mt-2 flex justify-end gap-2">
            <AlertDialog.Cancel className={`${BUTTON} border border-border-input text-fg hover:bg-tint-06`}>
              {cancelLabel}
            </AlertDialog.Cancel>
            <AlertDialog.Action className={`${BUTTON} ${styles.confirm}`} onClick={onConfirm}>
              {confirmLabel}
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
