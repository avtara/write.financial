// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FR-AI4's sender filter: an allowlist of senders, keywords that must appear, and ignore keywords that win over
 * everything (the last one wins). Pure text matching — the ingestion flow applies it to every fetched email.
 */
import { assistantInstant, parseAssistantAmount } from './assistant.ts';
import { modelMinorUnits, parseModelJsonObject } from './model-json.ts';
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

const stringOrNull = { type: ['string', 'null'] };
const confidenceScore = { type: 'integer', minimum: 0, maximum: 100 };

/**
 * Strict JSON Schema of the extraction prompt (worker `gmail` processor), sent as an OpenAI-compatible
 * `response_format`: every property required, nothing extra, missing evidence as `null`. Date and time are the email's
 * wall clock: models misplace offsets, so the app places them in the user's zone (`parseGmailAnswer`).
 */
export const GMAIL_EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['amountMinor', 'date', 'time', 'merchant', 'currency', 'accountId', 'categoryId', 'confidence'],
  properties: {
    amountMinor: { ...stringOrNull, description: 'Positive integer minor units as a decimal string' },
    date: { ...stringOrNull, description: 'Calendar date exactly as written in the email, YYYY-MM-DD' },
    time: {
      ...stringOrNull,
      description: 'Wall-clock time exactly as written in the email, HH:MM or HH:MM:SS; never convert time zones',
    },
    merchant: stringOrNull,
    currency: { ...stringOrNull, description: 'ISO 4217 code' },
    accountId: { ...stringOrNull, description: 'Owned matching account ID' },
    categoryId: { ...stringOrNull, description: 'Owned matching category ID' },
    confidence: {
      type: 'object',
      additionalProperties: false,
      required: [...GMAIL_FIELDS],
      properties: Object.fromEntries(GMAIL_FIELDS.map((field) => [field, confidenceScore])),
    },
  },
};

type NullableString = (field: string, max: number, entry?: unknown) => string | null;

const rejected = (): Error => new Error('Gmail extraction rejected');

/**
 * The checks both forms share; `instant` reads the form's own date fields. Missing evidence stays null, never a
 * zero-value or invented account draft.
 */
function parseGmailFields(text: string, instant: (nullableString: NullableString) => Date | null): GmailExtraction {
  if (text.length > 16_384) throw rejected();
  const value = parseModelJsonObject(text);
  const nullableString: NullableString = (field, max, entry = value[field]) => {
    if (entry === null) return null;
    if (typeof entry !== 'string' || !entry.trim() || entry.length > max) throw rejected();
    return entry.trim();
  };
  const amount = nullableString('amountMinor', 30, modelMinorUnits(value.amountMinor));
  const occurredAt = instant(nullableString);
  const currency = nullableString('currency', 3);
  if (currency !== null && !/^[A-Z]{3}$/.test(currency)) throw rejected();
  const accountId = nullableString('accountId', 36);
  const categoryId = nullableString('categoryId', 36);
  for (const id of [accountId, categoryId])
    if (id !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
      throw rejected();
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
    throw rejected();
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

/**
 * The model's answer: `date` and `time` are the email's wall clock, placed in `timeZone` here because models misplace
 * offsets. Either one missing leaves the instant null; a malformed one rejects the answer.
 */
export function parseGmailAnswer(text: string, timeZone: string): GmailExtraction {
  return parseGmailFields(text, (nullableString) => {
    const date = nullableString('date', 10);
    const time = nullableString('time', 8);
    const day = date === null ? null : parseLocalDate(date);
    if (time !== null && !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) throw rejected();
    if (day === null || time === null) return null;
    const seconds = time.length === 8 ? Number(time.slice(6)) : 0;
    return new Date(assistantInstant(day, time.slice(0, 5), timeZone).getTime() + seconds * 1000);
  });
}

/** The stored form (`extraction_enc`, review payloads): `occurredAt` is an RFC3339 instant with its offset. */
export function parseGmailExtraction(text: string): GmailExtraction {
  return parseGmailFields(text, (nullableString) => {
    const date = nullableString('occurredAt', 40);
    if (date === null) return null;
    const occurredAt = new Date(date);
    if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(date) || !Number.isFinite(occurredAt.getTime()))
      throw rejected();
    parseLocalDate(date.slice(0, 10));
    return occurredAt;
  });
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
