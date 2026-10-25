// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Statement import's server side (FR-L9): the browser parses the statement file (D4 — the file never leaves the
 * device, only resulting rows are sent) and sends at most {@link IMPORT_ROW_LIMIT} candidate rows; each valid one
 * becomes a pending review item (`import_row`, source `system`) whose payload is the proposed transaction. Confirming
 * happens through the ordinary review confirm functions (D14), so nothing is recorded until the user presses
 * "Impor N transaksi". Re-importing the same statement is idempotent: rows whose
 * {@link importDedupeKey} already has a review item come back as duplicates instead of new items.
 */
import { createHash } from 'node:crypto';
import type { Dek } from '@wf/crypto/envelope';
import { parseLocalDate, type LocalDate } from '@wf/domain/period';
import { normalizeTagSlug } from '@wf/domain/tags';
import { zonedInstant } from '@wf/domain/recurrence';
import { eq, inArray } from 'drizzle-orm';
import { withUser, type Database } from './db.ts';
import { userContextIn } from './ledger-core.ts';
import { LedgerError } from './ledger-errors.ts';
import { OCCURRENCE_TIME, insertReviewItemIn, type ReviewDraft } from './review-items.ts';
import { accounts } from './schema.ts';

/** Rows one import call may carry (one statement, per FR-L9). */
export const IMPORT_ROW_LIMIT = 500;

/** A candidate row the browser's import model produced (already parsed and normalized there). */
export interface ImportRowInput {
  /** Calendar date `YYYY-MM-DD` of the transaction. */
  readonly date: LocalDate;
  /** Positive, in the imported account's currency. */
  readonly amountMinor: bigint;
  /** `out` = money left the account, `in` = money arrived. */
  readonly direction: 'in' | 'out';
  readonly description: string | null;
  readonly categoryId: string | null;
  /** The other own account when the description names one (transfer between own accounts); `null` for an entry. */
  readonly transferAccountId: string | null;
  /** Tag slugs the matching rules suggested (FR-AI1); the user still confirms the row. */
  readonly tags: readonly string[];
}

export interface ImportProposalResult {
  /** Review items created for rows the account had no duplicate of yet. */
  readonly created: number;
  /** Rows whose dedupe key already has a review item (a re-import, or duplicates within the file). */
  readonly duplicates: number;
  /** Rows that failed the server-side validation (bad date, non-positive amount, unusable transfer target). */
  readonly rejected: number;
  /** The review items created, in row order. */
  readonly itemIds: readonly string[];
}

/**
 * `dedupe_key` of a proposed import row (`imp.` + SHA-256 of account, date, amount, and description): stable across
 * re-imports of the same statement, so replaying a file adds nothing.
 */
export function importDedupeKey(
  accountId: string,
  row: Pick<ImportRowInput, 'date' | 'amountMinor' | 'description'>,
): string {
  const hash = createHash('sha256')
    .update(`${accountId}|${row.date}|${row.amountMinor}|${row.description ?? ''}`)
    .digest('hex');
  return `imp.${hash}`;
}

/** The server-side row check: a real calendar date and a positive amount. */
function rowValid(row: ImportRowInput): boolean {
  try {
    parseLocalDate(row.date);
  } catch {
    return false;
  }
  if (row.amountMinor <= 0n || row.tags.length > 5) return false;
  return row.tags.every((tag) => normalizeTagSlug(tag) === tag);
}

export interface ImportReviewRepository {
  /**
   * Validates `rows` for the account (its ownership, dates, amounts, transfer targets) and inserts one pending
   * review item per accepted row; rows beyond {@link IMPORT_ROW_LIMIT} are ignored.
   * @throws {LedgerError} `NOT_FOUND` when the account (a transfer target's too) is not the user's
   */
  propose: (
    userId: string,
    input: { accountId: string; rows: readonly ImportRowInput[] },
  ) => Promise<ImportProposalResult>;
}

export function createImportReview(
  db: Database,
  { getDek }: { getDek: (userId: string) => Promise<Dek> },
): ImportReviewRepository {
  return {
    propose: async (userId, { accountId, rows }) => {
      // Fetched first: getDek opens its own transaction.
      const dek = await getDek(userId);
      return withUser(db, userId, async (tx) => {
        const [account] = await tx
          .select({ id: accounts.id, currency: accounts.currency })
          .from(accounts)
          .where(eq(accounts.id, accountId));
        if (account === undefined) throw new LedgerError('NOT_FOUND', 'No such account');
        const { timezone } = await userContextIn(tx, userId);
        // A row is only a transfer when its other account exists, belongs to the user, and shares the currency;
        // checking them all upfront keeps the row loop free of queries.
        const transferIds = [
          ...new Set(rows.map((row) => row.transferAccountId).filter((id): id is string => id !== null)),
        ];
        const own = new Map(
          transferIds.length === 0
            ? []
            : (
                await tx
                  .select({ id: accounts.id, currency: accounts.currency })
                  .from(accounts)
                  .where(inArray(accounts.id, transferIds))
              ).map((row) => [row.id, row.currency]),
        );
        const transferOf = (row: ImportRowInput): string | null => {
          if (row.transferAccountId === null) return null;
          return own.get(row.transferAccountId) === account.currency ? row.transferAccountId : null;
        };
        let created = 0;
        let duplicates = 0;
        let rejected = 0;
        const itemIds: string[] = [];
        for (const row of rows.slice(0, IMPORT_ROW_LIMIT)) {
          const transferAccountId = transferOf(row);
          if (!rowValid(row) || (row.transferAccountId !== null && transferAccountId === null)) {
            rejected += 1;
            continue;
          }
          const occurredAt = zonedInstant(row.date, OCCURRENCE_TIME, timezone);
          const draft: ReviewDraft =
            transferAccountId === null
              ? {
                  type: row.direction === 'in' ? ('income' as const) : ('expense' as const),
                  accountId,
                  amountMinor: row.amountMinor,
                  occurredAt,
                  source: 'import',
                  categoryId: row.categoryId,
                  description: row.description,
                  tags: row.tags,
                }
              : {
                  type: 'transfer' as const,
                  // Outgoing: money leaves the imported account; incoming: it arrives there.
                  fromAccountId: row.direction === 'out' ? accountId : transferAccountId,
                  toAccountId: row.direction === 'out' ? transferAccountId : accountId,
                  sentMinor: row.amountMinor,
                  receivedMinor: row.amountMinor,
                  fee: null,
                  occurredAt,
                  source: 'import',
                  description: row.description,
                  tags: row.tags,
                };
          const result = await insertReviewItemIn(tx, userId, dek, {
            reason: 'import_row',
            source: 'system',
            dedupeKey: importDedupeKey(accountId, row),
            dueDate: row.date,
            payload: { kind: 'transaction', draft },
          });
          if (result.created) {
            created += 1;
            itemIds.push(result.id);
          } else {
            duplicates += 1;
          }
        }
        return { created, duplicates, rejected, itemIds };
      });
    },
  };
}
