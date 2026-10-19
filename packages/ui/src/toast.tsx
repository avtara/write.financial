// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Toasts (FR-S6, design "Toast"): a short result with at most one action — "Urungkan" (undo), "Tinjau" (review),
 * "Coba lagi" (retry), "Lihat" (view). Mount `<Toaster>` once per layout; call `toast()` / `toast.undo()` anywhere.
 * sonner stacks them, pauses their timers while hovered or focused, announces them in a polite live region, and
 * moves focus to them with Alt+T. Its stylesheet comes from `styles.css` (its inline `<style>` is patched out for the
 * CSP); the card itself is ours.
 */
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { toast as sonner, Toaster as Sonner } from 'sonner';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  /** "Urungkan", "Tinjau", "Coba lagi", "Lihat". */
  label: string;
  onClick: () => void;
}

export interface ToastCardProps {
  title: string;
  /** One or two short lines; amounts go through `<Money>`, which honours privacy mode. */
  description?: ReactNode;
  /** Default `success`. */
  tone?: ToastTone;
  action?: ToastAction;
}

const TONE: Readonly<Record<ToastTone, { Icon: LucideIcon; color: string }>> = {
  success: { Icon: CircleCheck, color: 'text-green-fg' },
  error: { Icon: CircleAlert, color: 'text-red-fg' },
  warning: { Icon: TriangleAlert, color: 'text-amber-fg' },
  info: { Icon: Info, color: 'text-blue-fg' },
};

/** The toast card on its own (design "Toast": `$card`, r10, primary action button), also usable inline. */
export function ToastCard({ title, description, tone = 'success', action }: ToastCardProps) {
  const { Icon, color } = TONE[tone];
  return (
    <div className="flex w-full items-center gap-3 rounded-[10px] border border-border bg-card py-3.5 pr-3.5 pl-4 font-sans text-fg shadow-[0_8px_24px_var(--shadow)]">
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <Icon aria-hidden="true" className={`mt-px size-4 shrink-0 ${color}`} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-[13px] font-medium">{title}</p>
          {description === undefined ? null : <div className="text-[12px] text-muted-fg">{description}</div>}
        </div>
      </div>
      {action === undefined ? null : (
        <button
          type="button"
          onClick={action.onClick}
          className="inline-flex h-7 shrink-0 items-center rounded-[7px] bg-fg px-2.5 text-[12.5px] font-semibold text-primary-fg hover:bg-text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export interface ToastOptions extends ToastCardProps {
  /** Milliseconds on screen; default 5000. */
  duration?: number;
  /** Reusing an id replaces that toast instead of stacking a new one. */
  id?: string;
}

/** Shows a toast and returns its id. The action runs once and then dismisses the toast. */
export function toast({ duration = 5000, id, action, ...card }: ToastOptions): string | number {
  return sonner.custom(
    (toastId) => (
      <ToastCard
        {...card}
        {...(action === undefined
          ? {}
          : {
              action: {
                label: action.label,
                onClick: () => {
                  action.onClick();
                  sonner.dismiss(toastId);
                },
              },
            })}
      />
    ),
    { duration, ...(id === undefined ? {} : { id }) },
  );
}

export interface UndoToastOptions {
  /** "Transaksi dihapus". */
  title: string;
  /** "Shopee · −Rp389.000 dikembalikan ke BCA Tahapan." */
  description?: ReactNode;
  /** "Urungkan". */
  undoLabel: string;
  onUndo: () => void;
}

/** After a reversible change (delete, move, save): a success toast with "Urungkan", kept on screen for 8 s. */
toast.undo = ({ title, description, undoLabel, onUndo }: UndoToastOptions): string | number =>
  toast({
    title,
    description,
    action: { label: undoLabel, onClick: onUndo },
    duration: 8000,
  });

/** Removes one toast, or all without an id. */
toast.dismiss = sonner.dismiss;

export interface ToasterProps {
  /** Names the toast region for assistive technology, e.g. "Notifikasi". */
  label: string;
}

/** The toast region, bottom right, 400 px wide (design "Toast"). */
export function Toaster({ label }: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      customAriaLabel={label}
      gap={8}
      offset={24}
      style={{ '--width': '400px' } as CSSProperties}
      // Custom toasts get no width from sonner's stylesheet; fill the 400 px region.
      toastOptions={{ className: 'w-full' }}
    />
  );
}
