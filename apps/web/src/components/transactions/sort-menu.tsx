// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Urutkan" (FR-L2, design `iQHBZ`), opened from the sortable column headers: Terbaru dulu (default), Terlama dulu,
 * Jumlah terbesar, Jumlah terkecil, and "Kelompokkan per hari" — which an amount sort turns off.
 */
import { m } from '@wf/i18n/messages';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@wf/ui/dropdown-menu';
import type { ReactNode } from 'react';
import { TRANSACTION_SORTS, type TransactionSort, type TransactionsSearch } from '../../lib/transactions-search.ts';
import { tableModeOf } from './table-groups.ts';

const SORT_LABELS: Readonly<Record<TransactionSort, () => string>> = {
  date_desc: m.transactions_sort_date_desc,
  date_asc: m.transactions_sort_date_asc,
  amount_desc: m.transactions_sort_amount_desc,
  amount_asc: m.transactions_sort_amount_asc,
};

export interface SortMenuProps {
  readonly search: TransactionsSearch;
  readonly onSearchChange: (patch: Partial<TransactionsSearch>) => void;
  /** The header button that opens it. */
  readonly children: ReactNode;
}

export function SortMenu({ search, onSearchChange, children }: SortMenuProps) {
  const sort = search.sort ?? 'date_desc';
  const byAmount = sort.startsWith('amount');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[236px]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{m.transactions_sort_label()}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={sort}
            onValueChange={(value) => {
              onSearchChange({ sort: value === 'date_desc' ? undefined : (value as TransactionSort) });
            }}
          >
            {TRANSACTION_SORTS.map((value) => (
              <DropdownMenuRadioItem key={value} value={value}>
                {SORT_LABELS[value]()}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuCheckboxItem
            indicator="switch"
            checked={tableModeOf(search) === 'day'}
            disabled={byAmount}
            onCheckedChange={(on) => {
              onSearchChange({ view: on ? undefined : 'flat' });
            }}
          >
            {m.transactions_sort_group_by_day()}
          </DropdownMenuCheckboxItem>
          <p className="px-2 pb-1 text-[11px] text-subtle">{m.transactions_sort_group_note()}</p>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
