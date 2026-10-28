// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The ⋯ menu of a table row (design `OveDm`): Edit (E), Duplikat (D), Pisah transaksi, Ubah kategori ▸ (the current
 * category and the most used ones, then "Semua kategori…"), Pindah rekening, Tambah tag, Salin jumlah, Hapus (⌫).
 * Everything runs through `useTransactionActions()`; E, D, and ⌫ also work on the focused row (the table).
 */
import type { TransactionRow } from '@wf/db/transaction-query';
import { m } from '@wf/i18n/messages';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@wf/ui/dropdown-menu';
import { Money } from '@wf/ui/money';
import { ClipboardCopy, Copy, Ellipsis, Hash, Pencil, Search, Shapes, Split, Tag, Trash2, Wallet } from 'lucide-react';
import { categoryName } from '../../lib/ledger-labels.ts';
import { CATEGORY_ICONS } from '../category-icon.tsx';
import { frequentCategories } from '../ledger/category-picker.tsx';
import type { LedgerData } from '../ledger/use-transaction-form.ts';
import { usePreferences } from '../preferences.tsx';
import { useTransactionActions } from './transaction-actions.tsx';

/** Most used categories offered besides the current one. */
const FREQUENT_COUNT = 3;

export interface RowMenuProps {
  readonly row: TransactionRow;
  readonly ledger: LedgerData;
  /** The row's name ("Shopee"). */
  readonly label: string;
  readonly onOpen: (id: string) => void;
  /** Controlled, so a long-press on the row can open it too (FR-TB4). */
  readonly menuOpen: boolean;
  readonly onMenuOpenChange: (open: boolean) => void;
}

export function RowMenu({ row, ledger, label, onOpen, menuOpen, onMenuOpenChange }: RowMenuProps) {
  const actions = useTransactionActions();
  const { preferences } = usePreferences();
  const { locale, platform } = preferences;
  const categorized = row.type === 'expense' || row.type === 'income';
  const current = ledger.categories.find((category) => category.id === row.categoryId);
  const choices = categorized
    ? [
        ...(current === undefined ? [] : [current]),
        ...frequentCategories(ledger.categories, row.type)
          .filter((category) => category.id !== row.categoryId)
          .slice(0, FREQUENT_COUNT),
      ]
    : [];
  return (
    <DropdownMenu open={menuOpen} onOpenChange={onMenuOpenChange}>
      <DropdownMenuTrigger
        aria-label={m.transactions_menu_open({ name: label })}
        // Keyboard users reach it from the focused row (Tab); mouse users see it on hover; touch screens always show
        // it, 40 px wide (FR-TB4).
        className="flex size-7 items-center justify-center rounded-[6px] text-subtle opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-muted hover:text-fg focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-muted data-[state=open]:opacity-100 pointer-coarse:size-10 pointer-coarse:opacity-100"
      >
        <Ellipsis aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[220px]">
        <DropdownMenuGroup>
          <DropdownMenuItem
            icon={Pencil}
            shortcut={{ keys: ['E'], platform }}
            onSelect={() => {
              onOpen(row.id);
            }}
          >
            {m.transactions_menu_edit()}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={Copy}
            shortcut={{ keys: ['D'], platform }}
            onSelect={() => {
              actions.duplicate(row.id);
            }}
          >
            {m.transactions_menu_duplicate()}
          </DropdownMenuItem>
          {categorized ? (
            <DropdownMenuItem
              icon={Split}
              onSelect={() => {
                actions.split(row.id);
              }}
            >
              {m.transactions_menu_split()}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {categorized ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger icon={Tag}>{m.transactions_menu_change_category()}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-[220px]">
                <DropdownMenuGroup>
                  {choices.map((category) => {
                    const Glyph = CATEGORY_ICONS[category.icon]?.glyph ?? Shapes;
                    return (
                      <DropdownMenuCheckboxItem
                        key={category.id}
                        checked={category.id === row.categoryId}
                        onSelect={() => {
                          if (category.id !== row.categoryId) actions.changeCategory([row], category.id);
                        }}
                      >
                        <span className="flex items-center gap-2.5">
                          <Glyph aria-hidden="true" className="size-3.5 shrink-0" />
                          {categoryName(category)}
                        </span>
                      </DropdownMenuCheckboxItem>
                    );
                  })}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    icon={Search}
                    onSelect={() => {
                      actions.changeCategory([row]);
                    }}
                  >
                    {m.transactions_menu_all_categories()}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          {row.type === 'transfer' ? null : (
            <DropdownMenuItem
              icon={Wallet}
              onSelect={() => {
                actions.moveAccount([row]);
              }}
            >
              {m.transactions_menu_move_account()}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            icon={Hash}
            onSelect={() => {
              actions.addTag([row.id]);
            }}
          >
            {m.transactions_menu_add_tag()}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={ClipboardCopy}
            onSelect={() => {
              actions.copyAmount(row);
            }}
          >
            <span className="flex items-center justify-between gap-3">
              {m.transactions_menu_copy_amount()}
              <Money
                minor={row.amountMinor}
                currency={row.currency}
                context="table"
                locale={locale}
                className="text-[11px] text-subtle"
              />
            </span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            icon={Trash2}
            variant="destructive"
            shortcut={{ keys: ['⌫'], platform }}
            onSelect={() => {
              actions.remove([row]);
            }}
          >
            {m.transactions_menu_delete()}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
