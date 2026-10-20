// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The bulk bar's and row menu's dialogs (FR-L3, design `n71CLe`, `OveDm`): "Ubah kategori" (one kind at a time),
 * "Pindah rekening" (an active account of the same currency), and "Tambah tag". Transfers have neither a category
 * nor a single account, so they are left out and the dialog says so.
 */
import { m } from '@wf/i18n/messages';
import { useState } from 'react';
import { Button } from '../form.tsx';
import { AccountPicker, AccountTrigger } from '../ledger/account-picker.tsx';
import { CategorySelect } from '../ledger/category-picker.tsx';
import { TagInput } from '../ledger/tag-input.tsx';
import type { LedgerData } from '../ledger/use-transaction-form.ts';
import { Modal } from '../modal.tsx';
import { usePreferences } from '../preferences.tsx';
import type { ActionRow } from './action-row.ts';

interface Footer {
  readonly onCancel: () => void;
  /** `null` while there is nothing to apply (the button is disabled). */
  readonly onApply: (() => Promise<void>) | null;
  readonly label: string;
}

function Actions({ onCancel, onApply, label }: Footer) {
  const [pending, setPending] = useState(false);
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" size="sm" onClick={onCancel} disabled={pending}>
        {m.record_cancel()}
      </Button>
      <Button
        size="sm"
        disabled={onApply === null}
        pending={pending}
        {...(onApply === null
          ? {}
          : {
              onClick: () => {
                setPending(true);
                void onApply().finally(() => {
                  setPending(false);
                });
              },
            })}
      >
        {label}
      </Button>
    </div>
  );
}

/** The note under a dialog when some selected rows are skipped. */
function Skipped({ count }: { count: number }) {
  return count === 0 ? null : (
    <p className="text-[12px] text-subtle">{m.transactions_bulk_skipped_transfers({ count })}</p>
  );
}

export interface CategoryDialogProps {
  readonly rows: readonly ActionRow[];
  readonly ledger: LedgerData;
  readonly onCancel: () => void;
  readonly onApply: (ids: readonly string[], categoryId: string | null) => Promise<void>;
}

export function CategoryDialog({ rows, ledger, onCancel, onApply }: CategoryDialogProps) {
  const entries = rows.filter((row) => row.type !== 'transfer');
  const kinds = new Set(entries.map((row) => row.type));
  const kind = kinds.has('income') && !kinds.has('expense') ? 'income' : 'expense';
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const mixed = kinds.size > 1;
  return (
    <Modal
      open
      // Always open, so a change can only be a close.
      onOpenChange={onCancel}
      title={m.transactions_recategorize_title({ count: entries.length })}
    >
      {mixed ? (
        <p className="text-[13px] text-muted-fg">{m.transactions_recategorize_mixed()}</p>
      ) : (
        <CategorySelect
          categories={ledger.categories}
          kind={kind}
          value={categoryId}
          onValueChange={setCategoryId}
          label={m.transactions_recategorize_pick()}
          aria-label={m.transactions_recategorize_pick()}
          searchPlaceholder={m.category_picker_search()}
          placeholder={m.transactions_recategorize_pick()}
          className="h-[42px] rounded-[9px] px-3 text-[14px]"
        />
      )}
      <Skipped count={rows.length - entries.length} />
      <Actions
        onCancel={onCancel}
        label={m.transactions_bulk_apply()}
        onApply={
          mixed || categoryId === null || entries.length === 0
            ? null
            : () =>
                onApply(
                  entries.map((row) => row.id),
                  categoryId,
                )
        }
      />
    </Modal>
  );
}

export interface MoveAccountDialogProps {
  readonly rows: readonly ActionRow[];
  readonly ledger: LedgerData;
  readonly onCancel: () => void;
  readonly onApply: (ids: readonly string[], accountId: string) => Promise<void>;
}

export function MoveAccountDialog({ rows, ledger, onCancel, onApply }: MoveAccountDialogProps) {
  const { preferences } = usePreferences();
  const entries = rows.filter((row) => row.type !== 'transfer');
  const currencies = new Set(entries.map((row) => row.currency));
  const [currency] = currencies;
  const [accountId, setAccountId] = useState<string | null>(null);
  const candidates = ledger.accounts.filter((account) => account.status === 'active' && account.currency === currency);
  const chosen = candidates.find((account) => account.id === accountId);
  return (
    <Modal
      open
      // Always open, so a change can only be a close.
      onOpenChange={onCancel}
      title={m.transactions_move_title({ count: entries.length })}
      {...(currencies.size > 1 ? {} : { description: m.transactions_move_description({ currency: currency ?? '' }) })}
    >
      {currencies.size > 1 ? (
        <p className="text-[13px] text-muted-fg">{m.transactions_move_mixed()}</p>
      ) : (
        <AccountPicker
          accounts={candidates}
          value={accountId}
          onValueChange={setAccountId}
          label={m.transactions_move_pick()}
          searchPlaceholder={m.record_account_search()}
          locale={preferences.locale}
        >
          <AccountTrigger
            account={chosen}
            placeholder={m.transactions_move_pick()}
            aria-label={m.transactions_move_pick()}
          />
        </AccountPicker>
      )}
      <Skipped count={rows.length - entries.length} />
      <Actions
        onCancel={onCancel}
        label={m.transactions_bulk_apply()}
        onApply={
          currencies.size !== 1 || accountId === null
            ? null
            : () =>
                onApply(
                  entries.map((row) => row.id),
                  accountId,
                )
        }
      />
    </Modal>
  );
}

export interface AddTagDialogProps {
  readonly count: number;
  readonly ledger: LedgerData;
  readonly onCancel: () => void;
  readonly onApply: (tag: string) => Promise<void>;
}

export function AddTagDialog({ count, ledger, onCancel, onApply }: AddTagDialogProps) {
  const [tags, setTags] = useState<string[]>([]);
  const tag = tags.at(-1);
  return (
    <Modal
      open
      // Always open, so a change can only be a close.
      onOpenChange={onCancel}
      title={m.transactions_addtag_title({ count })}
      description={m.transactions_addtag_description()}
    >
      <TagInput
        value={tags}
        onValueChange={(next) => {
          // One tag at a time, the newest replacing the last; `TagInput` hands over slugs only.
          setTags(next.slice(-1));
        }}
        tags={ledger.tags}
      />
      <Actions
        onCancel={onCancel}
        label={m.transactions_bulk_apply()}
        onApply={tag === undefined ? null : () => onApply(tag)}
      />
    </Modal>
  );
}
