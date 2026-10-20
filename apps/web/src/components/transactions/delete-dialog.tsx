// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Hapus transaksi ini?" (FR-L6, design `NkXhx`): what is deleted, that attachments go with it and that it can be
 * undone for a few seconds, and each affected account's balance before → after ("Saldo BCA Tahapan Rp42.810.000 →
 * Rp43.199.000"; a transfer moves both accounts, its fee comes back to the source).
 */
import { m } from '@wf/i18n/messages';
import { formatDate, formatTime, toLocalDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { useState } from 'react';
import { categoryName } from '../../lib/ledger-labels.ts';
import { Button } from '../form.tsx';
import type { LedgerData } from '../ledger/use-transaction-form.ts';
import { Modal } from '../modal.tsx';
import { usePreferences } from '../preferences.tsx';
import { rowLabel, type ActionRow } from './action-row.ts';

export interface DeleteDialogProps {
  readonly rows: readonly ActionRow[];
  readonly ledger: LedgerData;
  readonly timeZone: string;
  readonly onCancel: () => void;
  readonly onConfirm: () => Promise<void>;
}

/** Account id → how deleting `rows` changes its balance (account currency). */
export function balanceChanges(rows: readonly ActionRow[]): Map<string, bigint> {
  const changes = new Map<string, bigint>();
  const add = (accountId: string, minor: bigint) => {
    changes.set(accountId, (changes.get(accountId) ?? 0n) + minor);
  };
  for (const row of rows) {
    add(row.accountId, -row.amountMinor + (row.feeMinor ?? 0n));
    if (row.toAccountId !== null && row.receivedMinor !== null) add(row.toAccountId, -row.receivedMinor);
  }
  return changes;
}

export function DeleteDialog({ rows, ledger, timeZone, onCancel, onConfirm }: DeleteDialogProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const [pending, setPending] = useState(false);
  const [first] = rows;
  const single = rows.length === 1 && first !== undefined ? first : null;
  const category = ledger.categories.find((candidate) => candidate.id === single?.categoryId);
  const attachments = rows.some((row) => row.hasAttachment);
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
      title={
        single === null ? m.transactions_delete_title_many({ count: rows.length }) : m.transactions_delete_title_one()
      }
      description={attachments ? m.transactions_delete_description_attachments() : m.transactions_delete_description()}
    >
      {single === null ? null : (
        <div className="flex items-center gap-3 rounded-[8px] border border-border px-3 py-2.5">
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px] font-medium text-fg">
              {category === undefined ? rowLabel(single, ledger) : categoryName(category)}
            </span>
            <span className="text-[12px] text-subtle">
              {formatDate(toLocalDate(single.occurredAt, timeZone), locale, 'weekday')} ·{' '}
              {formatTime(single.occurredAt, timeZone, locale)}
            </span>
          </div>
          <Money
            minor={single.amountMinor}
            currency={single.currency}
            context="amount"
            locale={locale}
            className="text-[14px] font-semibold text-fg"
          />
        </div>
      )}
      <ul className="flex flex-col gap-1.5">
        {[...balanceChanges(rows)].map(([accountId, change]) => {
          const account = ledger.accounts.find((candidate) => candidate.id === accountId);
          if (account === undefined || change === 0n) return null;
          return (
            <li key={accountId} className="flex items-center justify-between gap-3 text-[12.5px]">
              <span className="text-muted-fg">{m.transactions_delete_balance({ account: account.displayName })}</span>
              <span className="flex items-center gap-1.5 text-fg">
                <Money minor={account.balanceMinor} currency={account.currency} context="amount" locale={locale} />
                <span aria-hidden="true">→</span>
                <span className="sr-only">{m.transactions_delete_balance_to()}</span>
                <Money
                  minor={account.balanceMinor + change}
                  currency={account.currency}
                  context="amount"
                  locale={locale}
                  className="font-semibold"
                />
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={pending}>
          {m.record_cancel()}
        </Button>
        <Button
          variant="destructive"
          size="sm"
          pending={pending}
          onClick={() => {
            setPending(true);
            void onConfirm().finally(() => {
              setPending(false);
            });
          }}
        >
          {m.transactions_delete_confirm()}
        </Button>
      </div>
    </Modal>
  );
}
