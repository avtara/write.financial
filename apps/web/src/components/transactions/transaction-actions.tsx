// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The write actions of the Transactions page (FR-L3–L6), shared by the table's row menu, its bulk bar, the keyboard
 * shortcuts, and the detail panel: delete with its balance impact and "Urungkan" (design `NkXhx`, `pERdi`), duplicate
 * (`XOoye`), split (`GJppz`), change category, move to another account, add a tag, and copy the amount. Every write
 * reloads the route (`router.invalidate()`) and bumps {@link TransactionActions.version}, which the detail panel uses
 * to fetch again.
 */
import { useNavigate, useRouter } from '@tanstack/react-router';
import type { TransactionDetail } from '@wf/db/transactions';
import { formatMoney } from '@wf/domain/money';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { toast } from '@wf/ui/toast';
import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { rowLabel, type ActionRow } from './action-row.ts';
import type { Result } from '../../server/access.ts';
import {
  bulkAddTag,
  bulkMoveAccount,
  bulkSetCategory,
  getTransactionDetail,
  unsplitTransaction,
} from '../../server/fn/transactions.ts';
import { removeTransactions, restoreTransactions } from '../../server/fn/transactions-write.ts';
import type { LedgerData } from '../ledger/use-transaction-form.ts';
import { usePreferences } from '../preferences.tsx';
import { AddTagDialog, CategoryDialog, MoveAccountDialog } from './bulk-dialogs.tsx';
import { DeleteDialog } from './delete-dialog.tsx';
import { DuplicateSheet } from './duplicate-sheet.tsx';
import { SplitDialog } from './split-dialog.tsx';

export interface TransactionActions {
  /** Asks, then deletes (soft) with "Urungkan". */
  readonly remove: (rows: readonly ActionRow[]) => void;
  /** Opens the Duplicate sheet prefilled from the transaction. */
  readonly duplicate: (id: string) => void;
  /** Opens "Pisah transaksi" (expenses and incomes). */
  readonly split: (id: string) => void;
  /** Sets `categoryId` at once, or asks for one when it is omitted; transfers are skipped. */
  readonly changeCategory: (rows: readonly ActionRow[], categoryId?: string | null) => void;
  /** Asks for an account of the rows' currency; transfers are skipped. */
  readonly moveAccount: (rows: readonly ActionRow[]) => void;
  /** Asks for a tag to add. */
  readonly addTag: (ids: readonly string[]) => void;
  /** Copies the amount as shown in the table ("−42.000"). */
  readonly copyAmount: (row: ActionRow) => void;
  /** Increases after every write, so views fetched outside the route loader know to fetch again. */
  readonly version: number;
}

/** Thrown when `useTransactionActions` is used outside `<TransactionActionsProvider>`. */
export class MissingTransactionActionsProviderError extends Error {
  override name = 'MissingTransactionActionsProviderError';
}

const ActionsContext = createContext<TransactionActions | null>(null);

export function useTransactionActions(): TransactionActions {
  const actions = use(ActionsContext);
  if (actions === null) {
    throw new MissingTransactionActionsProviderError(
      'useTransactionActions() needs a <TransactionActionsProvider> above it',
    );
  }
  return actions;
}

type Dialog =
  | { readonly kind: 'delete'; readonly rows: readonly ActionRow[] }
  | { readonly kind: 'duplicate'; readonly detail: TransactionDetail }
  | { readonly kind: 'split'; readonly detail: TransactionDetail }
  | { readonly kind: 'category'; readonly rows: readonly ActionRow[] }
  | { readonly kind: 'move'; readonly rows: readonly ActionRow[] }
  | { readonly kind: 'tag'; readonly ids: readonly string[] };

export interface TransactionActionsProviderProps {
  readonly ledger: LedgerData;
  readonly timeZone: string;
  /** After a delete (e.g. to close the detail of a deleted transaction). */
  readonly onRemoved?: (ids: readonly string[]) => void;
  /** Opens a transaction's detail ("Lihat" after duplicating). */
  readonly onOpen?: (id: string) => void;
  readonly children: ReactNode;
}

export function TransactionActionsProvider({
  ledger,
  timeZone,
  onRemoved,
  onOpen,
  children,
}: TransactionActionsProviderProps) {
  const router = useRouter();
  const navigate = useNavigate();
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [version, setVersion] = useState(0);

  const changed = useCallback(async () => {
    setVersion((current) => current + 1);
    await router.invalidate();
  }, [router]);

  const failed = useCallback(
    (code: string) => {
      toast({ title: m.transactions_action_failed(), description: ledgerErrorMessage(code, locale), tone: 'error' });
    },
    [locale],
  );

  /** Runs a bulk write and reports it; `ids` already exclude what it skips. */
  const bulk = useCallback(
    async (write: () => Promise<Result<{ updated: string[] }>>, title: (count: number) => string) => {
      const result = await write();
      if (!result.ok) {
        failed(result.code);
        return false;
      }
      toast({ title: title(result.value.updated.length) });
      await changed();
      return true;
    },
    [changed, failed],
  );

  const withDetail = useCallback(
    async (id: string, open: (detail: TransactionDetail) => void) => {
      const result = await getTransactionDetail({ data: { id } });
      if (result.ok) open(result.value);
      else failed(result.code);
    },
    [failed],
  );

  const actions = useMemo<TransactionActions>(
    () => ({
      version,
      remove: (rows) => {
        if (rows.length > 0) setDialog({ kind: 'delete', rows });
      },
      duplicate: (id) => {
        void withDetail(id, (detail) => {
          setDialog({ kind: 'duplicate', detail });
        });
      },
      split: (id) => {
        void withDetail(id, (detail) => {
          setDialog({ kind: 'split', detail });
        });
      },
      changeCategory: (rows, categoryId) => {
        if (categoryId === undefined) {
          setDialog({ kind: 'category', rows });
          return;
        }
        const ids = rows.filter((row) => row.type !== 'transfer').map((row) => row.id);
        if (ids.length === 0) return;
        void bulk(
          () => bulkSetCategory({ data: { ids, categoryId } }),
          (count) => m.transactions_recategorize_done({ count }),
        );
      },
      moveAccount: (rows) => {
        if (rows.length > 0) setDialog({ kind: 'move', rows });
      },
      addTag: (ids) => {
        if (ids.length > 0) setDialog({ kind: 'tag', ids });
      },
      copyAmount: (row) => {
        const text = formatMoney(row.amountMinor, row.currency, { locale, context: 'table' });
        void navigator.clipboard.writeText(text).then(
          () => {
            toast({ title: m.transactions_copy_done(), description: text });
          },
          () => {
            toast({ title: m.transactions_copy_failed(), tone: 'error' });
          },
        );
      },
    }),
    [version, withDetail, bulk, locale],
  );

  const close = () => {
    setDialog(null);
  };

  const confirmRemove = async (rows: readonly ActionRow[]) => {
    const ids = rows.map((row) => row.id);
    const result = await removeTransactions({ data: { ids } });
    if (!result.ok) {
      failed(result.code);
      return;
    }
    close();
    onRemoved?.(result.value.deleted);
    const [first] = rows;
    const account = ledger.accounts.find((candidate) => candidate.id === first?.accountId);
    toast.undo({
      title:
        rows.length === 1 ? m.transactions_delete_done_one() : m.transactions_delete_done_many({ count: rows.length }),
      ...(rows.length === 1 && first !== undefined
        ? {
            description: (
              <>
                {rowLabel(first, ledger)}
                {' · '}
                <Money minor={first.amountMinor} currency={first.currency} context="amount" locale={locale} />{' '}
                {m.transactions_delete_done_returned({ account: account?.displayName ?? '' })}
              </>
            ),
          }
        : {}),
      undoLabel: m.record_undo(),
      onUndo: () => {
        void restoreTransactions({ data: { ids: result.value.deleted } }).then(async (restored) => {
          if (!restored.ok) failed(restored.code);
          await changed();
        });
      },
    });
    await changed();
  };

  return (
    <ActionsContext value={actions}>
      {children}
      {dialog?.kind === 'delete' ? (
        <DeleteDialog
          rows={dialog.rows}
          ledger={ledger}
          timeZone={timeZone}
          onCancel={close}
          onConfirm={() => confirmRemove(dialog.rows)}
        />
      ) : null}
      {dialog?.kind === 'duplicate' ? (
        <DuplicateSheet
          detail={dialog.detail}
          ledger={ledger}
          timeZone={timeZone}
          onClose={close}
          onSaved={async (id) => {
            close();
            toast({
              title: m.transactions_duplicate_done(),
              action: {
                label: m.transactions_duplicate_view(),
                onClick: () => {
                  if (onOpen === undefined) void navigate({ to: '/transactions', search: { tx: id } });
                  else onOpen(id);
                },
              },
            });
            await changed();
          }}
        />
      ) : null}
      {dialog?.kind === 'split' ? (
        <SplitDialog
          detail={dialog.detail}
          ledger={ledger}
          onClose={close}
          onSplit={async (parts) => {
            close();
            onRemoved?.([dialog.detail.id]);
            toast.undo({
              title: m.transactions_split_done({ count: parts }),
              undoLabel: m.record_undo(),
              onUndo: () => {
                void unsplitTransaction({ data: { id: dialog.detail.id } }).then(async (undone) => {
                  if (!undone.ok) failed(undone.code);
                  await changed();
                });
              },
            });
            await changed();
          }}
        />
      ) : null}
      {dialog?.kind === 'category' ? (
        <CategoryDialog
          rows={dialog.rows}
          ledger={ledger}
          onCancel={close}
          onApply={async (ids, categoryId) => {
            if (
              await bulk(
                () => bulkSetCategory({ data: { ids: [...ids], categoryId } }),
                (count) => m.transactions_recategorize_done({ count }),
              )
            ) {
              close();
            }
          }}
        />
      ) : null}
      {dialog?.kind === 'move' ? (
        <MoveAccountDialog
          rows={dialog.rows}
          ledger={ledger}
          onCancel={close}
          onApply={async (ids, accountId) => {
            if (
              await bulk(
                () => bulkMoveAccount({ data: { ids: [...ids], accountId } }),
                (count) => m.transactions_move_done({ count }),
              )
            ) {
              close();
            }
          }}
        />
      ) : null}
      {dialog?.kind === 'tag' ? (
        <AddTagDialog
          count={dialog.ids.length}
          ledger={ledger}
          onCancel={close}
          onApply={async (tag) => {
            if (
              await bulk(
                () => bulkAddTag({ data: { ids: [...dialog.ids], tag } }),
                (count) => m.transactions_addtag_done({ count, tag }),
              )
            ) {
              close();
            }
          }}
        />
      ) : null}
    </ActionsContext>
  );
}
