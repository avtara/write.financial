// SPDX-License-Identifier: AGPL-3.0-only
import { encrypt } from '@wf/crypto/cipher';
import type { Dek } from '@wf/crypto/envelope';
import type { AiProvider } from '@wf/domain/ai';
import {
  isReceiptDuplicate,
  parseReceiptExtraction,
  type ReceiptExtraction,
  type ReceiptItem,
} from '@wf/domain/receipt';
import { and, desc, eq, gte, isNull, lte } from 'drizzle-orm';
import { withUser, type Database, type Transaction } from './db.ts';
import { LedgerError } from './ledger-errors.ts';
import { decodeReceipt, encodeReceipt, type ReceiptPayload } from './receipt-jobs.ts';
import { insertReviewItemIn, readReviewPayload, type ReviewDraft } from './review-items.ts';
import { attachments, postings, receiptUploads, reviewItems, transactions } from './schema.ts';

export interface ReceiptView {
  id: string;
  status: typeof receiptUploads.$inferSelect.status;
  name: string;
  errorCode: string | null;
  reviewItemId: string | null;
  transactionId: string | null;
  extraction: ReceiptExtraction | null;
  draft: ReviewDraft | null;
  duplicates: {
    id: string;
    merchant: string | null;
    description: string | null;
    occurredAt: Date;
    amountMinor: bigint;
    accountId: string;
    categoryId: string | null;
  }[];
}
export interface ReceiptsRepository {
  stage(
    userId: string,
    input: { id: string; revision: string; provider: AiProvider; payload: ReceiptPayload },
  ): Promise<boolean>;
  get(userId: string, id: string): Promise<ReceiptView>;
  cancel(userId: string, id: string): Promise<string[]>;
  manual(userId: string, id: string, draft: ReviewDraft & { type: 'expense' }): Promise<string>;
}
async function receiptIn(tx: Transaction, id: string) {
  const [row] = await tx.select().from(receiptUploads).where(eq(receiptUploads.id, id)).for('update');
  if (row === undefined) throw new LedgerError('NOT_FOUND', 'No such receipt');
  return row;
}
async function duplicatesIn(tx: Transaction, extraction: ReceiptExtraction) {
  const rows = await tx
    .select({
      id: transactions.id,
      description: transactions.description,
      merchant: transactions.merchant,
      occurredAt: transactions.occurredAt,
      amountMinor: postings.amountMinor,
      accountId: postings.accountId,
      categoryId: transactions.categoryId,
    })
    .from(transactions)
    .innerJoin(postings, eq(postings.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.type, 'expense'),
        eq(postings.currency, extraction.currency),
        eq(postings.role, 'principal'),
        isNull(transactions.deletedAt),
        gte(transactions.occurredAt, new Date(extraction.occurredAt.getTime() - 7_200_000)),
        lte(transactions.occurredAt, new Date(extraction.occurredAt.getTime() + 7_200_000)),
      ),
    )
    .orderBy(desc(transactions.occurredAt));
  return rows
    .map((row) => ({ ...row, amountMinor: -row.amountMinor }))
    .filter((row) => isReceiptDuplicate(extraction, row));
}
/** Called only inside the single review-confirm transaction; candidate matching is rechecked at the point of mutation. */
export async function receiptDuplicateIn(
  tx: Transaction,
  userId: string,
  dek: Dek,
  id: string,
  transactionId: string,
): Promise<void> {
  const row = await receiptIn(tx, id);
  const payload = decodeReceipt(dek, userId, id, row.payloadEnc);
  if (payload.evidence === null || row.reviewItemId === null) throw new LedgerError('INVALID_TRANSACTION');
  const matches = await duplicatesIn(tx, parseReceiptExtraction(payload.evidence, payload.timeZone));
  if (!matches.some((entry) => entry.id === transactionId))
    throw new LedgerError('NOT_FOUND', 'No matching transaction');
}
/** Receipt/ledger atomicity: a failed attachment or ledger guard rolls the whole confirmation back. */
export async function attachReceiptIn(
  tx: Transaction,
  userId: string,
  dek: Dek,
  id: string,
  transactionId: string,
  now: Date,
  correctedItems?: readonly ReceiptItem[],
): Promise<void> {
  const row = await receiptIn(tx, id);
  if (row.status === 'attached' && row.transactionId === transactionId) return;
  if (row.status !== 'ready') throw new LedgerError('INVALID_TRANSACTION', 'Receipt is not ready');
  const payload = decodeReceipt(dek, userId, id, row.payloadEnc);
  const [target] = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), isNull(transactions.deletedAt)))
    .for('update');
  if (target === undefined) throw new LedgerError('NOT_FOUND');
  if (payload.evidence !== null) {
    const extraction = parseReceiptExtraction(payload.evidence, payload.timeZone);
    const [principal] = await tx
      .select({ currency: postings.currency })
      .from(postings)
      .where(and(eq(postings.transactionId, transactionId), eq(postings.role, 'principal')));
    if (principal?.currency !== extraction.currency)
      throw new LedgerError('INVALID_ACCOUNT', 'Receipt currency must match the account');
  }
  await tx.insert(attachments).values({
    userId,
    transactionId,
    bucket: 'attachments',
    objectKey: payload.original.key,
    thumbnailKey: payload.original.mime === 'application/pdf' ? (payload.pages[0]?.key ?? null) : null,
    mime: payload.original.mime,
    size: payload.original.size,
    sha256: payload.original.sha256,
    kind: 'receipt',
    nameEnc: encrypt(dek, payload.name, { userId, purpose: 'attachments.name' }),
    ocrEnc:
      payload.evidence === null && payload.failedEvidence === undefined
        ? null
        : encrypt(
            dek,
            JSON.stringify(
              { original: payload.evidence ?? payload.failedEvidence, correctedItems: correctedItems ?? null },
              (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
            ),
            { userId, purpose: 'attachments.ocr' },
          ),
  });
  await tx
    .update(receiptUploads)
    .set({ status: 'attached', transactionId, updatedAt: now })
    .where(eq(receiptUploads.id, id));
}
export function createReceipts(
  db: Database,
  { getDek, now = () => new Date() }: { getDek: (userId: string) => Promise<Dek>; now?: () => Date },
): ReceiptsRepository {
  return {
    manual: async (userId, id, draft) => {
      const dek = await getDek(userId);
      return withUser(db, userId, async (tx) => {
        const row = await receiptIn(tx, id);
        if (row.reviewItemId !== null) return row.reviewItemId;
        if (row.status !== 'failed') throw new LedgerError('INVALID_TRANSACTION');
        const proposal = await insertReviewItemIn(tx, userId, dek, {
          reason: 'ai_suggestion',
          source: 'receipt',
          dedupeKey: `receipt.${id}`,
          payload: { kind: 'transaction', receiptId: id, draft: { ...draft, source: 'receipt' } },
        });
        await tx
          .update(receiptUploads)
          .set({ status: 'ready', reviewItemId: proposal.id, updatedAt: now() })
          .where(eq(receiptUploads.id, id));
        return proposal.id;
      });
    },
    stage: async (userId, input) => {
      const dek = await getDek(userId);
      return withUser(db, userId, async (tx) => {
        const rows = await tx
          .insert(receiptUploads)
          .values({
            id: input.id,
            userId,
            revision: input.revision,
            provider: input.provider,
            payloadEnc: encodeReceipt(dek, userId, input.id, input.payload),
            createdAt: now(),
            updatedAt: now(),
          })
          .onConflictDoNothing()
          .returning({ id: receiptUploads.id });
        if (rows.length === 0) await receiptIn(tx, input.id);
        return rows.length !== 0;
      });
    },
    get: async (userId, id) => {
      const dek = await getDek(userId);
      return withUser(db, userId, async (tx) => {
        const row = await receiptIn(tx, id);
        const payload = decodeReceipt(dek, userId, id, row.payloadEnc);
        const extraction =
          payload.evidence === null ? null : parseReceiptExtraction(payload.evidence, payload.timeZone);
        const [item] =
          row.reviewItemId === null
            ? []
            : await tx.select().from(reviewItems).where(eq(reviewItems.id, row.reviewItemId));
        const proposal = item === undefined ? null : readReviewPayload(dek, userId, item.payloadEnc);
        const draft = proposal?.kind === 'transaction' ? proposal.draft : null;
        const duplicates = extraction === null ? [] : await duplicatesIn(tx, extraction);
        return {
          id,
          status: row.status,
          name: payload.name,
          errorCode: row.errorCode,
          reviewItemId: row.reviewItemId,
          transactionId: row.transactionId,
          extraction,
          draft,
          duplicates,
        };
      });
    },
    cancel: async (userId, id) => {
      const dek = await getDek(userId);
      return withUser(db, userId, async (tx) => {
        const row = await receiptIn(tx, id);
        if (row.status === 'attached') return [];
        const payload = decodeReceipt(dek, userId, id, row.payloadEnc);
        await tx.update(receiptUploads).set({ status: 'cancelled', updatedAt: now() }).where(eq(receiptUploads.id, id));
        if (row.reviewItemId !== null)
          await tx
            .update(reviewItems)
            .set({ status: 'ignored', resolvedAt: now(), updatedAt: now() })
            .where(and(eq(reviewItems.id, row.reviewItemId), eq(reviewItems.status, 'pending')));
        return [...new Set([payload.original.key, ...payload.pages.map((page) => page.key)])];
      });
    },
  };
}
