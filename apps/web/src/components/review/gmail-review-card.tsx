// SPDX-License-Identifier: AGPL-3.0-only
import type { ReviewEdits } from '@wf/db/review';
import type { Locale } from '@wf/domain/money';
import type { LocalDate } from '@wf/domain/period';
import type { ReviewLookup } from './review-cards.tsx';
import type { GmailReviewItem } from './review-model.ts';
import { ReviewTransactionForm, reviewEditsFromInput } from './review-transaction-form.tsx';

/** Gmail proposals use the transaction edit form; evidence remains readable underneath it. */
export function GmailReviewCard({
  item,
  lookup,
  locale,
  timeZone,
  today,
  pending,
  onConfirm,
  onIgnore,
  onCancel,
}: {
  item: GmailReviewItem;
  lookup: ReviewLookup;
  locale: Locale;
  timeZone: string;
  today: LocalDate;
  pending: boolean;
  onConfirm: (
    edits: Required<Pick<ReviewEdits, 'amountMinor' | 'occurredAt' | 'accountId' | 'categoryId'>> & {
      readonly description: string;
    } & Pick<ReviewEdits, 'note' | 'tags'>,
  ) => void;
  onIgnore: () => void;
  onCancel?: (() => void) | undefined;
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
      onConfirm={(input) => {
        if (input.type !== 'expense' || !input.description?.trim()) return;
        onConfirm({
          ...reviewEditsFromInput(input),
          amountMinor: input.amountMinor,
          occurredAt: input.occurredAt,
          accountId: input.accountId,
          categoryId: input.categoryId,
          description: input.description,
        });
      }}
    />
  );
}
