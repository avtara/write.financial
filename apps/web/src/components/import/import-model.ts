// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The import review's pure model (FR-L9): turns the statement rows {@link import-parse.ts} extracted into candidates
 * for the review table, marking duplicates against the account's existing transactions in the window (same day, same
 * amount, similar description), detecting transfers to the user's own accounts (the description names one), and
 * guessing categories from the account's history (the newest historical transaction whose description shares one
 * keyword — simple and explainable). The server re-checks everything (see `server/fn/import.ts`).
 */
import type { AccountView } from '@wf/db/accounts';
import type { TransactionRow } from '@wf/db/transaction-query';
import type { LocalDate } from '@wf/domain/period';
import type { ParsedStatement } from './import-parse.ts';

/** How similar two descriptions must be (Dice coefficient over bigrams) to call a row a duplicate. */
const DUPLICATE_SIMILARITY = 0.6;
/** Shortest keyword the category guesser matches on. */
const MIN_KEYWORD = 3;

/** A row as the parser produced it: `errors` non-empty means the row is unreadable ("Gagal dibaca"). */
export interface ParsedRow {
  /** 1-based data-row number in the file ("Baris 17"). */
  readonly row: number;
  readonly date: LocalDate | null;
  /** Positive, in minor units; `null` when the amount column is empty or unreadable. */
  readonly amountMinor: number | null;
  readonly direction: 'in' | 'out' | null;
  readonly description: string | null;
  /** Localized per-row reasons (why the row is unreadable); empty when readable. */
  readonly errors: readonly string[];
}

/** An unreadable review-table row: it shows its reasons and is never sent. */
export interface ErrorCandidate {
  readonly row: number;
  readonly date: null;
  readonly amountMinor: null;
  readonly direction: null;
  readonly description: string | null;
  readonly categoryId: null;
  readonly transfer: null;
  readonly status: 'error';
  readonly guessedFrom: null;
  /** The per-row reasons of an unreadable row (always non-empty; they are what the row shows). */
  readonly errors: readonly string[];
}

/** A readable review-table row: `new` goes to the review CTA, `duplicate` is shown but never sent. */
export interface ReadableCandidate {
  readonly row: number;
  readonly date: LocalDate;
  /** Positive, in the imported account's currency. */
  readonly amountMinor: bigint;
  readonly direction: 'in' | 'out';
  readonly description: string | null;
  /** Guess (or keep `null`: the row goes to "Lainnya" unless the user picks one). */
  readonly categoryId: string | null;
  /** The other own account when the description names one and its currency matches; `null` for an entry. */
  readonly transfer: AccountView | null;
  readonly status: 'new' | 'duplicate';
  /** The keyword the category guess matched on, for the "✦ …" hint; `null` without a guess. */
  readonly guessedFrom: string | null;
  readonly errors: readonly [];
}

export type ImportCandidate = ErrorCandidate | ReadableCandidate;

/** A readable, non-duplicate candidate. */
export type NewCandidate = ReadableCandidate & { readonly status: 'new' };

/** The `new` candidates: exactly what "Impor N transaksi" sends to the server. */
export const isNewCandidate = (candidate: ImportCandidate): candidate is NewCandidate => candidate.status === 'new';

/** The four tiles of the review step (design `Z0eAyw`). */
export interface ImportStats {
  readonly found: number;
  readonly toImport: number;
  readonly duplicates: number;
  readonly unreadable: number;
}

/** Lowercases and keeps only letters and digits, so "TRSF KE BIBIT RDPU" and "Bibit RDPU" meet. */
export function normalizeText(text: string): string {
  return text.toLowerCase().replaceAll(/[^a-z0-9]/g, '');
}

/** Words of at least {@link MIN_KEYWORD} characters, for the keyword match. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= MIN_KEYWORD);
}

/** Dice coefficient of the two strings' character bigrams (0–1); 1 for identical, 0 without a shared bigram. */
export function similarity(a: string, b: string): number {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let index = 0; index < left.length - 1; index += 1) {
    const bigram = left.slice(index, index + 2);
    bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
  }
  let shared = 0;
  for (let index = 0; index < right.length - 1; index += 1) {
    const bigram = right.slice(index, index + 2);
    const count = bigrams.get(bigram) ?? 0;
    if (count > 0) {
      bigrams.set(bigram, count - 1);
      shared += 1;
    }
  }
  return (2 * shared) / (left.length - 1 + right.length - 1);
}

/**
 * The own account the description transfers to or from: the longest account name that appears inside the
 * description, with the same currency as the imported account (a cross-currency match stays an entry).
 */
export function detectTransfer(
  description: string | null,
  accountId: string,
  currency: string,
  accounts: readonly AccountView[],
): AccountView | null {
  if (description === null || description.trim() === '') return null;
  const haystack = normalizeText(description);
  let best: AccountView | null = null;
  for (const account of accounts) {
    if (account.id === accountId || account.currency !== currency) continue;
    const name = normalizeText(account.displayName);
    if (name.length < MIN_KEYWORD || !haystack.includes(name)) continue;
    if (best === null || normalizeText(best.displayName).length < name.length) best = account;
  }
  return best;
}

/**
 * The category of the newest historical transaction whose description shares a word with this one (the history is
 * newest first); the shared word is returned for the "✦ …" hint. `null` when nothing matches.
 */
export function guessCategory(
  description: string | null,
  history: readonly Pick<TransactionRow, 'description' | 'categoryId'>[],
): { categoryId: string; keyword: string } | null {
  if (description === null) return null;
  const tokens = new Set(words(description));
  for (const row of history) {
    if (row.categoryId === null) continue;
    for (const word of words(row.description ?? '')) {
      if (tokens.has(word)) return { categoryId: row.categoryId, keyword: word };
    }
  }
  return null;
}

/**
 * Whether `existing` is the same transaction as the candidate row: same day, the same amount (the stored row signs
 * it — expenses are negative, a transfer's received leg is positive), and a similar description.
 */
export function isDuplicate(
  date: LocalDate,
  amountMinor: bigint,
  description: string | null,
  existing: Pick<TransactionRow, 'localDate' | 'amountMinor' | 'receivedMinor' | 'description'>,
): boolean {
  if (existing.localDate !== date) return false;
  const sameAmount =
    existing.amountMinor === amountMinor ||
    existing.amountMinor === -amountMinor ||
    existing.receivedMinor === amountMinor;
  if (!sameAmount) return false;
  if (description === null || existing.description === null) return true;
  return similarity(description, existing.description) >= DUPLICATE_SIMILARITY;
}

export interface ImportContext {
  readonly accountId: string;
  readonly currency: string;
  /** The user's own accounts (for transfer detection). */
  readonly accounts: readonly AccountView[];
  /** The account's existing transactions in the statement's window (newest first is fine). */
  readonly existing: readonly TransactionRow[];
  /** The account's history for category guesses, newest first (the newest match wins). */
  readonly history: readonly Pick<TransactionRow, 'description' | 'categoryId'>[];
}

export interface ImportCandidates {
  readonly candidates: readonly ImportCandidate[];
  readonly stats: ImportStats;
}

/**
 * Builds the review table: unreadable rows keep their reasons, readable rows are marked as duplicates (against the
 * account's transactions and against earlier rows of the same file) or left as new, get a transfer target, and get
 * a category guess.
 */
export function buildCandidates(parsed: readonly ParsedRow[], context: ImportContext): ImportCandidates {
  const candidates: ImportCandidate[] = [];
  let duplicates = 0;
  const seen = new Set<string>();
  for (const row of parsed) {
    if (row.errors.length > 0 || row.date === null || row.amountMinor === null || row.direction === null) {
      candidates.push({
        row: row.row,
        date: null,
        amountMinor: null,
        direction: null,
        description: row.description,
        categoryId: null,
        transfer: null,
        status: 'error',
        guessedFrom: null,
        errors: row.errors,
      });
      continue;
    }
    const amountMinor = BigInt(row.amountMinor);
    // Const locals keep the guard's narrowing inside the `find` callback.
    const date = row.date;
    const description = row.description;
    const duplicateOf =
      context.existing.find((existing) => isDuplicate(date, amountMinor, description, existing)) !== undefined;
    const key = `${date}|${amountMinor}|${row.direction}|${description ?? ''}`;
    const duplicateInFile = seen.has(key);
    seen.add(key);
    const transfer = detectTransfer(description, context.accountId, context.currency, context.accounts);
    const guess = transfer === null ? guessCategory(description, context.history) : null;
    const isDup = duplicateOf || duplicateInFile;
    if (isDup) duplicates += 1;
    candidates.push({
      row: row.row,
      date,
      amountMinor,
      direction: row.direction,
      description,
      categoryId: isDup ? null : (guess?.categoryId ?? null),
      transfer: isDup ? null : transfer,
      status: isDup ? 'duplicate' : 'new',
      guessedFrom: guess?.keyword ?? null,
      errors: [],
    });
  }
  return {
    candidates,
    stats: {
      found: candidates.length,
      toImport: candidates.filter(isNewCandidate).length,
      duplicates,
      unreadable: candidates.filter((candidate) => candidate.status === 'error').length,
    },
  };
}

/** The date span of the readable rows (`from`–`to`), for the window the duplicates are fetched in. */
export function windowOf(parsed: readonly ParsedRow[]): { from: LocalDate; to: LocalDate } | null {
  const dates = parsed.map((row) => row.date).filter((date): date is LocalDate => date !== null);
  if (dates.length === 0) return null;
  return { from: [...dates].sort()[0] as LocalDate, to: [...dates].sort()[dates.length - 1] as LocalDate };
}

/** What the done step reports ("N transaksi tercatat", duplicates, failures). */
export interface ImportResult {
  readonly imported: number;
  readonly duplicates: number;
  readonly failed: number;
}

/**
 * The wizard's three steps (upload → review → done) as one state, so every step's data is exactly what that step
 * needs: the review carries the chosen account, the parsed statement, and the candidates; the done step the result.
 */
export type ImportStage =
  | { readonly step: 'upload' }
  | {
      readonly step: 'review';
      /** The account the rows are imported into (picked before the file is read). */
      readonly account: AccountView;
      readonly statement: ParsedStatement;
      readonly candidates: ImportCandidates;
    }
  | { readonly step: 'done'; readonly result: ImportResult };

/** The user's category choice for one review row (`null` = back to "Lainnya"); the other steps pass through. */
export function withCategory(stage: ImportStage, row: number, categoryId: string | null): ImportStage {
  if (stage.step !== 'review') return stage;
  return {
    ...stage,
    candidates: {
      ...stage.candidates,
      candidates: stage.candidates.candidates.map((candidate) => {
        if (candidate.row !== row) return candidate;
        return candidate.status === 'error' ? candidate : { ...candidate, categoryId, guessedFrom: null };
      }),
    },
  };
}
