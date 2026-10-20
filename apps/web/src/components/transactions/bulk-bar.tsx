// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The bar over the table while rows are selected (FR-L3, design `n71CLe`): "3 dipilih" with their total, Ubah kategori,
 * Pindah rekening, Tambah tag, Hapus, and × — Escape clears the selection too, unless something else (a menu, a
 * dialog) already used that Escape.
 */
import type { TransactionRow } from '@wf/db/transaction-query';
import { m } from '@wf/i18n/messages';
import { Hash, Tag, Trash2, Wallet, X } from 'lucide-react';
import { useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import { usePreferences } from '../preferences.tsx';
import { useTransactionActions } from './transaction-actions.tsx';
import { SignedMoney } from './transaction-row.tsx';

export interface BulkBarProps {
  /** The selected rows (at least one). */
  readonly rows: readonly TransactionRow[];
  readonly baseCurrency: string;
  readonly onClear: () => void;
}

function BarButton({
  icon: Icon,
  label,
  onClick,
  tone = 'default',
}: {
  readonly icon: LucideIcon;
  readonly label: string;
  readonly onClick: () => void;
  readonly tone?: 'default' | 'destructive';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-[13px] hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring ${tone === 'destructive' ? 'text-red-fg' : 'text-text-secondary hover:text-fg'}`}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </button>
  );
}

export function BulkBar({ rows, baseCurrency, onClear }: BulkBarProps) {
  const actions = useTransactionActions();
  const { preferences } = usePreferences();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClear();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClear]);
  const ids = rows.map((row) => row.id);
  return (
    <div
      role="toolbar"
      aria-label={m.transactions_bulk_label()}
      className="sticky bottom-4 z-10 mx-auto flex w-fit items-center gap-1 rounded-[12px] border border-border-strong bg-popover p-1.5 shadow-[0_16px_40px_var(--shadow)]"
    >
      <span className="flex items-center gap-2 border-r border-border pr-3 pl-1.5">
        <span className="flex size-[22px] items-center justify-center rounded-[6px] bg-fg font-mono text-[12px] font-semibold text-primary-fg">
          {rows.length}
        </span>
        <span className="flex flex-col">
          <span className="text-[13px] font-medium text-fg">{m.transactions_bulk_selected()}</span>
          <SignedMoney
            amountMinor={rows.reduce((sum, row) => sum + row.amountBaseMinor, 0n)}
            currency={baseCurrency}
            locale={preferences.locale}
            className="text-[11px] text-subtle"
          />
        </span>
      </span>
      <BarButton
        icon={Tag}
        label={m.transactions_bulk_change_category()}
        onClick={() => {
          actions.changeCategory(rows);
        }}
      />
      <BarButton
        icon={Wallet}
        label={m.transactions_bulk_move_account()}
        onClick={() => {
          actions.moveAccount(rows);
        }}
      />
      <BarButton
        icon={Hash}
        label={m.transactions_bulk_add_tag()}
        onClick={() => {
          actions.addTag(ids);
        }}
      />
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
      <BarButton
        icon={Trash2}
        tone="destructive"
        label={m.transactions_bulk_delete()}
        onClick={() => {
          actions.remove(rows);
        }}
      />
      <button
        type="button"
        aria-label={m.transactions_bulk_clear()}
        onClick={onClear}
        className="flex size-8 items-center justify-center rounded-[7px] text-subtle hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
