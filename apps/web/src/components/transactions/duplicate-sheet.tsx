// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Duplikat transaksi" (FR-L6, design `XOoye`): the Record Transaction form filled with the original's fields, dated
 * now; attachments are not copied. Saving records a new transaction linked to the original (`duplicated_from_id`).
 */
import type { TransactionDetail } from '@wf/db/transactions';
import { m } from '@wf/i18n/messages';
import { formatDate, toLocalDate } from '@wf/ui/dates';
import { Sheet } from '@wf/ui/sheet';
import { useState } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { duplicateTransaction } from '../../server/fn/transactions.ts';
import { valuesFromDetail } from '../ledger/transaction-draft.ts';
import { TransactionForm } from '../ledger/transaction-form.tsx';
import type { LedgerData } from '../ledger/use-transaction-form.ts';
import { usePreferences } from '../preferences.tsx';
import { rowLabel, actionRowOf } from './action-row.ts';

export interface DuplicateSheetProps {
  readonly detail: TransactionDetail;
  readonly ledger: LedgerData;
  readonly timeZone: string;
  readonly onClose: () => void;
  /** After saving, with the new transaction's id. */
  readonly onSaved: (id: string) => Promise<void>;
}

export function DuplicateSheet({ detail, ledger, timeZone, onClose, onSaved }: DuplicateSheetProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  // Fixed when the sheet opens: "Hari ini, 19.45".
  const [initial] = useState(() => valuesFromDetail(detail, { timeZone, locale, at: new Date() }));
  const today = toLocalDate(new Date(), timeZone);
  return (
    <Sheet
      open
      // Always open, so a change can only be a close.
      onOpenChange={onClose}
      title={m.transactions_duplicate_title()}
      description={m.transactions_duplicate_description({
        label: rowLabel(actionRowOf(detail), ledger),
        date: formatDate(detail.localDate, locale, 'day'),
      })}
      closeLabel={m.transactions_detail_close()}
      size="lg"
    >
      <div className="flex flex-col gap-4">
        {detail.attachments.length === 0 ? null : (
          <p className="rounded-[8px] bg-tint-06 px-3 py-2 text-[12.5px] text-muted-fg">
            {m.transactions_duplicate_no_attachments()}
          </p>
        )}
        <TransactionForm
          mode="create"
          initial={initial}
          data={ledger}
          locale={locale}
          timeZone={timeZone}
          today={today}
          onCancel={onClose}
          onSubmit={async (input) => {
            const result = await duplicateTransaction({
              data: {
                id: detail.id,
                input: detail.merchant === null ? input : { ...input, merchant: detail.merchant },
              },
            });
            if (!result.ok) return ledgerErrorMessage(result.code, locale);
            await onSaved(result.value.id);
            return null;
          }}
        />
      </div>
    </Sheet>
  );
}
