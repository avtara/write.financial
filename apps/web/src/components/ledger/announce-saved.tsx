// SPDX-License-Identifier: AGPL-3.0-only
/** "Tersimpan" toast with "Urungkan" (FR-T9), shared by Record, Quick Add, receipts, and Gmail. */
import { m } from '@wf/i18n/messages';
import type { Locale } from '@wf/domain/money';
import { Money } from '@wf/ui/money';
import { toast } from '@wf/ui/toast';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { removeTransactions } from '../../server/fn/transactions-write.ts';

export function announceSaved(saved: {
  readonly id: string;
  readonly label: string;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly accountName: string | undefined;
  readonly locale: Locale;
  readonly onChange: () => void;
}): void {
  toast.undo({
    title: m.record_saved_title(),
    description: (
      <>
        {saved.label}
        {' · '}
        <Money minor={saved.amountMinor} currency={saved.currency} context="amount" locale={saved.locale} />
        {' · '}
        {saved.accountName}
      </>
    ),
    undoLabel: m.record_undo(),
    onUndo: () => {
      void removeTransactions({ data: { ids: [saved.id] } }).then((result) => {
        if (result.ok) {
          toast({ tone: 'info', title: m.record_undone() });
          saved.onChange();
        } else {
          toast({ tone: 'error', title: ledgerErrorMessage(result.code, saved.locale) });
        }
      });
    },
  });
}
