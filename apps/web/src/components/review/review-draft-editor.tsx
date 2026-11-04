// SPDX-License-Identifier: AGPL-3.0-only
import type { ReviewEdits } from '@wf/db/review';
import type { Locale } from '@wf/domain/money';
import type { LocalDate } from '@wf/domain/period';
import type { ReviewLookup } from './review-cards.tsx';
import type { DraftItem } from './review-model.ts';
import { ReviewTransactionForm, reviewEditsFromInput } from './review-transaction-form.tsx';

/** The same form as transaction-detail editing, submitting corrections to the pending proposal. */
export function ReviewDraftEditor({
  item,
  lookup,
  locale,
  timeZone,
  today,
  pending,
  onConfirm,
  onIgnore,
  onCancel,
  onUnpaid,
}: {
  item: DraftItem;
  lookup: ReviewLookup;
  locale: Locale;
  timeZone: string;
  today: LocalDate;
  pending: boolean;
  onConfirm: (edits: ReviewEdits) => void;
  onIgnore: () => void;
  onCancel?: (() => void) | undefined;
  onUnpaid: (() => void) | undefined;
}) {
  return (
    <ReviewTransactionForm
      item={item}
      lookup={lookup}
      locale={locale}
      timeZone={timeZone}
      today={today}
      pending={pending}
      onIgnore={onIgnore}
      onCancel={onCancel}
      onUnpaid={onUnpaid}
      onConfirm={(input) => {
        onConfirm(reviewEditsFromInput(input));
      }}
    />
  );
}
