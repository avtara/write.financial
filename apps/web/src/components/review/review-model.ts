// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Review queue page's model (FR-L7): the pending items split into the design's panels (AI results, deleted
 * categories, subscription bills, recurring schedules, period-close proposals), how late a due item is, and what a
 * group of bills adds up to.
 */
import type { ReviewItemView } from '@wf/db/review';
import type { ReviewDraft, ReviewPayload } from '@wf/db/review-items';
import { countDays, type LocalDate } from '@wf/domain/period';

/** A `transaction` item: an AI result, an import row, or a due occurrence. */
export type DraftItem = ReviewItemView & {
  readonly payload: { readonly kind: 'transaction'; readonly draft: ReviewDraft };
};
export type CategoryItem = ReviewItemView & { readonly payload: { readonly kind: 'category' } };
export type CloseItem = ReviewItemView & { readonly payload: { readonly kind: 'rollover' | 'leftover' } };
/** The server labels a Gmail item with its merchant, else the email subject, so it always has one. */
export type GmailReviewItem = ReviewItemView & {
  readonly label: string;
  readonly payload: Extract<ReviewPayload, { kind: 'gmail' }>;
};

export interface ReviewGroups {
  /** AI suggestions and import rows (Gmail, Assistant, receipts), by confidence. */
  readonly ai: readonly DraftItem[];
  readonly gmail: readonly GmailReviewItem[];
  /** Transactions whose category was deleted ("Perlu kategori"). */
  readonly categories: readonly CategoryItem[];
  /** Subscription bills that are due ("Belum / Sudah dibayar"). */
  readonly bills: readonly DraftItem[];
  /** Due occurrences of recurring transactions, transfers, and contributions. */
  readonly recurring: readonly DraftItem[];
  /** Period-close proposals: the leftover move and rollovers. */
  readonly closing: readonly CloseItem[];
}

/** Splits the pending items (already in the queue's order) into the page's panels. */
export function groupReviewItems(items: readonly ReviewItemView[]): ReviewGroups {
  const ai: DraftItem[] = [];
  const gmail: GmailReviewItem[] = [];
  const categories: CategoryItem[] = [];
  const bills: DraftItem[] = [];
  const recurring: DraftItem[] = [];
  const closing: CloseItem[] = [];
  for (const item of items) {
    const { payload } = item;
    if (payload.kind === 'category') categories.push(item as CategoryItem);
    else if (payload.kind === 'gmail') gmail.push(item as GmailReviewItem);
    else if (payload.kind !== 'transaction') closing.push(item as CloseItem);
    else if (item.reason !== 'due_occurrence') ai.push(item as DraftItem);
    else if (item.occurrence?.sourceType === 'subscription') bills.push(item as DraftItem);
    else recurring.push(item as DraftItem);
  }
  return { ai, gmail, categories, bills, recurring, closing };
}

export type DueState =
  | { readonly kind: 'overdue'; readonly days: number }
  | { readonly kind: 'today' }
  | { readonly kind: 'upcoming'; readonly days: number };

/** "Jatuh tempo lewat 6 hari" / "hari ini" / "N hari lagi" (a bill paid early). */
export function dueState(due: LocalDate, today: LocalDate): DueState {
  if (due === today) return { kind: 'today' };
  return due < today
    ? { kind: 'overdue', days: countDays(due, today) - 1 }
    : { kind: 'upcoming', days: countDays(today, due) - 1 };
}

/** The amount a proposed transaction moves out of (or into) its paying account, and that account. */
export function draftAmount(draft: ReviewDraft): { readonly accountId: string; readonly amountMinor: bigint } {
  return draft.type === 'transfer'
    ? { accountId: draft.fromAccountId, amountMinor: draft.sentMinor }
    : { accountId: draft.accountId, amountMinor: draft.amountMinor };
}

/** "Total menunggu": the bills' amounts per currency, in first-seen order. */
export function pendingTotals(
  items: readonly DraftItem[],
  currencyOf: (accountId: string) => string,
): { readonly currency: string; readonly amountMinor: bigint }[] {
  const totals = new Map<string, bigint>();
  for (const item of items) {
    const { accountId, amountMinor } = draftAmount(item.payload.draft);
    const currency = currencyOf(accountId);
    totals.set(currency, (totals.get(currency) ?? 0n) + amountMinor);
  }
  return [...totals].map(([currency, amountMinor]) => ({ currency, amountMinor }));
}
