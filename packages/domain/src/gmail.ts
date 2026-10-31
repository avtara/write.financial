// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FR-AI4's sender filter: an allowlist of senders, keywords that must appear, and ignore keywords that win over
 * everything (the last one wins). Pure text matching — the ingestion flow applies it to every fetched email.
 */
import { parseAssistantAmount } from './assistant.ts';
import { parseLocalDate } from './period.ts';

/** The user's Gmail filter (design `kHEuC`): senders, keywords, ignore keywords. */
export interface GmailFilters {
  /** Sender addresses or domains ("billing@pln.co.id", "netflix.com") that may pass. */
  readonly senders: readonly string[];
  /** At least one must appear in the subject (empty = no keyword requirement). */
  readonly keywords: readonly string[];
  /** Any hit rejects the email, whatever the senders and keywords said. */
  readonly ignoreKeywords: readonly string[];
}

export const GMAIL_FILTER_RESULTS = ['passed', 'filtered', 'ignored_keyword'] as const;
export type GmailFilterResult = (typeof GMAIL_FILTER_RESULTS)[number];

/** The addresses a sender matches: the full address and its domain. */
const senderKeys = (from: string): readonly string[] => {
  const lower = (/<([^<>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
  const domain = /^[^\s@<>]+@([^\s@<>]+)$/.exec(lower)?.[1] ?? '';
  return domain === '' ? [] : [lower, domain];
};

const containsAny = (haystack: string, needles: readonly string[]): boolean =>
  needles.some((needle) => needle.trim() !== '' && haystack.toLowerCase().includes(needle.trim().toLowerCase()));

/**
 * The filter verdict for one email. A sender match (address or domain) passes; keywords refine it (any hit passes when
 * the list is non-empty); an ignore-keyword hit always rejects — "kata kunci pengabaian menang" (design).
 */
export function filterEmail(from: string, subject: string, filters: GmailFilters): GmailFilterResult {
  if (containsAny(`${from} ${subject}`, filters.ignoreKeywords)) return 'ignored_keyword';
  const senderOk =
    filters.senders.length === 0 ||
    senderKeys(from).some((key) => filters.senders.map((s) => s.toLowerCase().trim()).includes(key));
  if (!senderOk) return 'filtered';
  if (filters.keywords.length > 0 && !containsAny(subject, filters.keywords)) return 'filtered';
  return 'passed';
}

/** The default filters of a fresh connection: everything from anyone, nothing ignored. */
export function emptyGmailFilters(): GmailFilters {
  return { senders: [], keywords: [], ignoreKeywords: [] };
}

export const GMAIL_FIELDS = ['amount', 'date', 'merchant', 'category', 'account', 'currency'] as const;
export type GmailField = (typeof GMAIL_FIELDS)[number];
export interface GmailExtraction {
  readonly amountMinor: bigint | null;
  readonly occurredAt: Date | null;
  readonly merchant: string | null;
  readonly categoryId: string | null;
  readonly accountId: string | null;
  readonly currency: string | null;
  readonly confidence: Record<GmailField, number>;
}

/** Models often wrap "only JSON" in one Markdown fence (` ```json … ``` `); exactly that wrapper is unwrapped. */
const FENCED = /^\s*```(?:json)?[ \t]*\n([\s\S]*?)\n[ \t]*```\s*$/i;

/** Missing evidence stays null, never a zero-value or invented account draft. */
export function parseGmailExtraction(text: string): GmailExtraction {
  if (text.length > 16_384) throw new Error('Gmail extraction rejected');
  const value = JSON.parse(FENCED.exec(text)?.[1] ?? text) as Record<string, unknown>;
  const nullableString = (field: string, max: number): string | null => {
    const entry = value[field];
    if (entry === null) return null;
    if (typeof entry !== 'string' || !entry.trim() || entry.length > max) throw new Error('Gmail extraction rejected');
    return entry.trim();
  };
  const amount = nullableString('amountMinor', 30);
  const date = nullableString('occurredAt', 40);
  const occurredAt = date === null ? null : new Date(date);
  if (
    date !== null &&
    (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(date) || !Number.isFinite(occurredAt?.getTime()))
  )
    throw new Error('Gmail extraction rejected');
  if (date !== null) parseLocalDate(date.slice(0, 10));
  const currency = nullableString('currency', 3);
  if (currency !== null && !/^[A-Z]{3}$/.test(currency)) throw new Error('Gmail extraction rejected');
  const accountId = nullableString('accountId', 36);
  const categoryId = nullableString('categoryId', 36);
  for (const id of [accountId, categoryId])
    if (id !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
      throw new Error('Gmail extraction rejected');
  const confidence = value.confidence as Record<GmailField, number> | null;
  if (
    confidence === null ||
    typeof confidence !== 'object' ||
    GMAIL_FIELDS.some(
      (field) =>
        typeof confidence[field] !== 'number' ||
        !Number.isFinite(confidence[field]) ||
        confidence[field] < 0 ||
        confidence[field] > 100,
    )
  )
    throw new Error('Gmail extraction rejected');
  return {
    amountMinor: amount === null ? null : parseAssistantAmount(amount),
    occurredAt,
    merchant: nullableString('merchant', 200),
    currency,
    accountId,
    categoryId,
    confidence,
  };
}

/** FR-AI4 deliberately ignores merchant/account guesses: same user's manual expense, same currency only. */
export function isGmailManualDuplicate(
  extraction: Pick<GmailExtraction, 'amountMinor' | 'occurredAt' | 'currency'>,
  candidate: { amountMinor: bigint; occurredAt: Date; currency: string },
): boolean {
  if (extraction.amountMinor === null || extraction.occurredAt === null || extraction.currency !== candidate.currency)
    return false;
  const difference =
    extraction.amountMinor > candidate.amountMinor
      ? extraction.amountMinor - candidate.amountMinor
      : candidate.amountMinor - extraction.amountMinor;
  return (
    Math.abs(extraction.occurredAt.getTime() - candidate.occurredAt.getTime()) <= 7_200_000 &&
    difference * 100n <= candidate.amountMinor
  );
}
