// SPDX-License-Identifier: AGPL-3.0-only
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  icon: LucideIcon;
  /** "Belum ada transaksi". */
  title: string;
  description?: string;
  /** The first steps, e.g. "Catat transaksi" and "Impor mutasi" buttons. */
  actions?: ReactNode;
  /** A reassurance line under the actions, e.g. "Semua dicatat manual · …". */
  note?: ReactNode;
  /** Faded placeholder rows above the icon, hinting at the table that will fill the page. */
  ghostRows?: boolean;
  className?: string;
}

/** Widths of the faded placeholder rows (design "Ghost"). */
const GHOST_ROWS = ['w-[160px]', 'w-[120px]', 'w-[190px]'] as const;

/**
 * The first-run state of a page with no data yet (design "Kosong — pengguna baru"): an icon tile, a title, a short
 * explanation, the first actions, and an optional note. Plain content, not a live region. For loading, errors, and
 * "no results for this filter" use `PageState`.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  note,
  ghostRows = false,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3.5 rounded-[16px] border border-border bg-card p-10 text-center ${className}`}
    >
      {ghostRows ? (
        <div aria-hidden="true" className="flex w-full max-w-[520px] flex-col pb-[18px] opacity-50">
          {GHOST_ROWS.map((width) => (
            <div key={width} className="flex h-10 items-center gap-3 border-b border-border px-3">
              <span className="h-2 w-9 rounded-[3px] bg-surface-3" />
              <span className={`h-2 rounded-[3px] bg-surface-3 ${width}`} />
              <span className="ml-auto h-2 w-[70px] rounded-[3px] bg-surface-3" />
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex size-[52px] items-center justify-center rounded-[14px] border border-border bg-surface-3">
        <Icon aria-hidden="true" className="size-[22px] text-muted-fg" />
      </div>
      <p className="text-[20px] font-semibold text-fg">{title}</p>
      {description === undefined ? null : (
        <p className="max-w-[500px] text-[14px] leading-[22px] text-muted-fg">{description}</p>
      )}
      {actions === undefined ? null : <div className="flex flex-wrap justify-center gap-2 pt-1.5">{actions}</div>}
      {note === undefined ? null : (
        <div className="flex items-center gap-1.5 pt-1.5 text-[12px] text-subtle">{note}</div>
      )}
    </div>
  );
}
