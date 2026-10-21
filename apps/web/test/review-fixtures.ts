// SPDX-License-Identifier: AGPL-3.0-only
/** Review queue items as `listReviewItems` returns them, after the design persona (FR-L7). */
import type { ReviewItemView } from '@wf/db/review';
import type { ReviewDraft } from '@wf/db/review-items';
import type { LocalDate, YearMonth } from '@wf/domain/period';
import { BCA, categoryId, JAGO } from './ledger-fixtures.ts';

const at = (iso: string) => new Date(iso);

export function reviewItem(id: string, patch: Partial<ReviewItemView> = {}): ReviewItemView {
  return {
    id,
    reason: 'due_occurrence',
    source: 'schedule',
    status: 'pending',
    payload: { kind: 'transaction', draft: netflixDraft() },
    occurrence: null,
    label: null,
    periodLabel: null,
    subjectTransactionId: null,
    subject: null,
    allocations: [],
    periodId: null,
    dueDate: null,
    aiConfidence: null,
    resultingTransactionId: null,
    resolvedAt: null,
    createdAt: at('2026-10-15T00:05:00Z'),
    ...patch,
  };
}

function netflixDraft(): Extract<ReviewDraft, { type: 'expense' | 'income' }> {
  return {
    type: 'expense',
    occurredAt: at('2026-10-18T05:00:00Z'),
    source: 'recurring',
    accountId: BCA.id,
    amountMinor: 186_000n,
    categoryId: categoryId('system:subscriptions'),
    merchant: 'Netflix',
    description: 'Premium 4K',
  };
}

const occurrence = (sourceType: 'subscription' | 'recurrence', dueDate: string) => ({
  id: `occ-${dueDate}`,
  sourceType,
  sourceId: `src-${dueDate}`,
  status: 'due_review' as const,
  dueDate: dueDate as LocalDate,
});

/** Netflix, due 18 Okt (paid from BCA Tahapan). */
export const NETFLIX_ITEM = reviewItem('rv-netflix', {
  label: 'Netflix',
  dueDate: '2026-10-18' as LocalDate,
  occurrence: occurrence('subscription', '2026-10-18'),
});

/** iCloud+, 9 Okt, 6 days overdue on 15 Okt. */
export const ICLOUD_ITEM = reviewItem('rv-icloud', {
  label: 'iCloud+',
  dueDate: '2026-10-09' as LocalDate,
  occurrence: occurrence('subscription', '2026-10-09'),
  payload: {
    kind: 'transaction',
    draft: { ...netflixDraft(), merchant: 'iCloud+', description: '200 GB', amountMinor: 45_000n },
  },
});

/** "Sisihkan dana tidak rutin" BCA Tahapan → Bank Jago, 25 Okt, split into goals. */
export const SISIHKAN_ITEM = reviewItem('rv-sisihkan', {
  label: 'Sisihkan dana tidak rutin',
  dueDate: '2026-10-25' as LocalDate,
  occurrence: occurrence('recurrence', '2026-10-25'),
  payload: {
    kind: 'transaction',
    draft: {
      type: 'transfer',
      occurredAt: at('2026-10-25T05:00:00Z'),
      source: 'recurring',
      fromAccountId: BCA.id,
      toAccountId: JAGO.id,
      sentMinor: 1_150_000n,
      receivedMinor: 1_150_000n,
      description: 'Sisihkan dana tidak rutin',
    },
  },
  allocations: [
    { goalId: 'g-bali', goalName: 'Liburan Bali', amountMinor: 867_000n },
    { goalId: 'g-motor', goalName: 'Servis motor', amountMinor: 240_000n },
    { goalId: 'g-stnk', goalName: 'Perpanjang STNK', amountMinor: 43_000n },
  ],
});

/** An AI result from Gmail with its confidence. */
export const GMAIL_ITEM = reviewItem('rv-gmail', {
  reason: 'ai_suggestion',
  source: 'gmail',
  label: 'Tokopedia',
  aiConfidence: 62,
  payload: {
    kind: 'transaction',
    draft: {
      type: 'expense',
      occurredAt: at('2026-10-15T08:40:00Z'),
      source: 'gmail',
      accountId: BCA.id,
      amountMinor: 189_000n,
      categoryId: null,
      merchant: 'Tokopedia',
    },
  },
});

/** A Tokopedia expense whose category "Belanja Online" was deleted. */
export const CATEGORY_ITEM = reviewItem('rv-mouse', {
  reason: 'category_deleted',
  source: 'system',
  label: 'Tokopedia',
  subjectTransactionId: 'tx-mouse',
  payload: {
    kind: 'category',
    transactionId: 'tx-mouse',
    previousCategoryId: 'cat-online',
    previousCategoryName: 'Belanja Online',
  },
  subject: {
    type: 'expense',
    occurredAt: at('2026-10-12T13:41:00Z'),
    merchant: 'Tokopedia',
    description: 'Mouse wireless',
    accountId: BCA.id,
    amountMinor: -189_000n,
    currency: 'IDR',
  },
});

/** September's leftover Rp1.150.000 → Dana Darurat. */
export const LEFTOVER_ITEM = reviewItem('rv-leftover', {
  reason: 'period_close_proposal',
  source: 'period_close',
  label: 'Dana Darurat',
  periodLabel: '2026-09' as YearMonth,
  periodId: 'p-sep',
  payload: {
    kind: 'leftover',
    periodId: 'p-sep',
    amountMinor: 1_150_000n,
    goalId: 'g-darurat',
    fromAccountId: BCA.id,
    toAccountId: JAGO.id,
  },
});

/** A rollover of Makan & Dapur's remainder. */
export const ROLLOVER_ITEM = reviewItem('rv-rollover', {
  reason: 'period_close_proposal',
  source: 'period_close',
  periodLabel: '2026-09' as YearMonth,
  payload: {
    kind: 'rollover',
    periodId: 'p-sep',
    nextPeriodId: 'p-oct',
    categoryId: categoryId('system:food'),
    deltaMinor: 300_000n,
  },
});
