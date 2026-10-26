// SPDX-License-Identifier: AGPL-3.0-only
import { decryptText, encrypt } from '@wf/crypto/cipher';
import type { Dek } from '@wf/crypto/envelope';
import type { AiProvider } from '@wf/domain/ai';
import { parseReceiptExtraction, type ReceiptExtraction } from '@wf/domain/receipt';
import { evaluateRules } from '@wf/domain/rules';
import { and, asc, eq, inArray, lt, or } from 'drizzle-orm';
import { firstRow, withUser, type Database } from './db.ts';
import { LedgerError } from './ledger-errors.ts';
import { insertReviewItemIn } from './review-items.ts';
import { accounts, attachments, autoRules, categories, receiptUploads, reviewItems } from './schema.ts';

export interface ReceiptObject {
  key: string;
  size: number;
  sha256: string;
  mime: string;
}
/** The entire sensitive payload has user- and upload-bound AAD. No extracted text in jobs or metadata columns. */
export interface ReceiptPayload {
  name: string;
  original: ReceiptObject;
  pages: ReceiptObject[];
  timeZone: string;
  evidence: string | null;
  failedEvidence?: string;
}
export function encodeReceipt(dek: Dek, userId: string, id: string, value: ReceiptPayload): Uint8Array {
  return encrypt(dek, JSON.stringify(value), { userId, purpose: `receipt_uploads.${id}` });
}
export function decodeReceipt(dek: Dek, userId: string, id: string, bytes: Uint8Array): ReceiptPayload {
  return JSON.parse(decryptText(dek, bytes, { userId, purpose: `receipt_uploads.${id}` })) as ReceiptPayload;
}
export interface ReceiptJobClaim {
  revision: string;
  provider: AiProvider;
  payload: ReceiptPayload;
  accounts: { id: string; name: string; currency: string }[];
  categories: { id: string; name: string }[];
}
export interface ReceiptJobs {
  claim(userId: string, id: string): Promise<ReceiptJobClaim | null>;
  complete(userId: string, id: string, evidence: string): Promise<void>;
  fail(userId: string, id: string, code: string, evidence?: string): Promise<void>;
  cleanup(userId: string): Promise<string[]>;
}

/** Only receipt state and review proposals are writable; this module never imports a ledger mutation repository. */
export function createReceiptJobs(
  db: Database,
  { getDek, now = () => new Date() }: { getDek: (userId: string) => Promise<Dek>; now?: () => Date },
): ReceiptJobs {
  return {
    cleanup: async (userId) => {
      const dek = await getDek(userId);
      return withUser(db, userId, async (tx) => {
        const rows = await tx
          .select()
          .from(receiptUploads)
          .where(
            or(
              eq(receiptUploads.status, 'attached'),
              and(
                inArray(receiptUploads.status, ['failed', 'cancelled', 'queued', 'reading']),
                lt(receiptUploads.updatedAt, new Date(now().getTime() - 7 * 86_400_000)),
              ),
              eq(receiptUploads.status, 'ready'),
            ),
          )
          .for('update');
        const candidates = new Set<string>();
        for (const row of rows) {
          if (row.status === 'ready') {
            const [item] =
              row.reviewItemId === null
                ? []
                : await tx.select().from(reviewItems).where(eq(reviewItems.id, row.reviewItemId));
            if (item?.status !== 'ignored') continue;
          }
          const payload = decodeReceipt(dek, userId, row.id, row.payloadEnc);
          for (const object of [payload.original, ...payload.pages]) candidates.add(object.key);
          if (row.status !== 'attached')
            await tx
              .update(receiptUploads)
              .set({ status: 'cancelled', errorCode: 'RECEIPT_EXPIRED' })
              .where(eq(receiptUploads.id, row.id));
        }
        const retained = await tx
          .select({ key: attachments.objectKey, thumbnail: attachments.thumbnailKey })
          .from(attachments);
        for (const object of retained) {
          candidates.delete(object.key);
          if (object.thumbnail !== null) candidates.delete(object.thumbnail);
        }
        return [...candidates];
      });
    },
    claim: async (userId, id) => {
      const dek = await getDek(userId);
      return withUser(db, userId, async (tx) => {
        const [row] = await tx.select().from(receiptUploads).where(eq(receiptUploads.id, id)).for('update');
        if (row === undefined) throw new LedgerError('NOT_FOUND', 'No such receipt');
        if (row.status !== 'queued') {
          // A process may have died after dispatching a billed call. A replay must never send it again.
          if (row.status === 'reading')
            await tx
              .update(receiptUploads)
              .set({ status: 'failed', errorCode: 'RECEIPT_INTERRUPTED', updatedAt: now() })
              .where(eq(receiptUploads.id, id));
          return null;
        }
        await tx.update(receiptUploads).set({ status: 'reading', updatedAt: now() }).where(eq(receiptUploads.id, id));
        const accountRows = await tx
          .select()
          .from(accounts)
          .where(eq(accounts.status, 'active'))
          .orderBy(asc(accounts.createdAt));
        const categoryRows = await tx.select().from(categories).where(eq(categories.kind, 'expense'));
        return {
          revision: row.revision,
          provider: row.provider,
          payload: decodeReceipt(dek, userId, id, row.payloadEnc),
          accounts: accountRows.map((account) => ({
            id: account.id,
            name: account.displayName,
            currency: account.currency,
          })),
          categories: categoryRows
            .filter((category) => category.archivedAt === null && category.deletedAt === null)
            .map((category) => ({ id: category.id, name: category.name })),
        };
      });
    },
    complete: async (userId, id, evidence) => {
      const dek = await getDek(userId);
      await withUser(db, userId, async (tx) => {
        const row = firstRow(
          await tx.select().from(receiptUploads).where(eq(receiptUploads.id, id)).for('update'),
          'receipt',
        );
        if (row.status !== 'reading') return;
        const payload = decodeReceipt(dek, userId, id, row.payloadEnc);
        const extraction: ReceiptExtraction = parseReceiptExtraction(evidence, payload.timeZone);
        const ownedAccounts = await tx
          .select()
          .from(accounts)
          .where(and(eq(accounts.status, 'active'), eq(accounts.currency, extraction.currency)));
        const account = ownedAccounts.find((entry) => entry.id === extraction.accountId) ?? ownedAccounts[0];
        if (account === undefined)
          throw new LedgerError('INVALID_ACCOUNT', 'Choose an account with the receipt currency');
        const ruleRows = await tx.select().from(autoRules).orderBy(asc(autoRules.position));
        const rules = evaluateRules(ruleRows, {
          description: `${extraction.merchant} ${extraction.description}`,
          date: extraction.date,
          minuteOfDay: Number(extraction.time.slice(0, 2)) * 60 + Number(extraction.time.slice(3)),
          accountIds: [account.id],
          direction: 'expense',
          subscription: false,
        });
        const categoryId = rules.categoryId ?? extraction.categoryId;
        const [category] =
          categoryId === null
            ? []
            : await tx
                .select()
                .from(categories)
                .where(and(eq(categories.id, categoryId), eq(categories.kind, 'expense')));
        const proposal = await insertReviewItemIn(tx, userId, dek, {
          reason: 'ai_suggestion',
          source: 'receipt',
          dedupeKey: `receipt.${id}`,
          payload: {
            kind: 'transaction',
            receiptId: id,
            draft: {
              type: 'expense',
              occurredAt: extraction.occurredAt,
              accountId: account.id,
              amountMinor: extraction.amountMinor,
              categoryId: category?.archivedAt === null && category.deletedAt === null ? category.id : null,
              description: extraction.description,
              merchant: extraction.merchant,
              note: null,
              tags: rules.tagOverflow ? [] : [...rules.tags],
              source: 'receipt',
            },
          },
        });
        await tx
          .update(receiptUploads)
          .set({
            status: 'ready',
            reviewItemId: proposal.id,
            payloadEnc: encodeReceipt(dek, userId, id, { ...payload, evidence }),
            updatedAt: now(),
          })
          .where(eq(receiptUploads.id, id));
      });
    },
    fail: async (userId, id, code, evidence) => {
      const dek = await getDek(userId);
      await withUser(db, userId, async (tx) => {
        const [row] = await tx.select().from(receiptUploads).where(eq(receiptUploads.id, id)).for('update');
        if (row?.status !== 'reading') return;
        const payload = decodeReceipt(dek, userId, id, row.payloadEnc);
        await tx
          .update(receiptUploads)
          .set({
            status: 'failed',
            errorCode: code,
            updatedAt: now(),
            ...(evidence === undefined
              ? {}
              : { payloadEnc: encodeReceipt(dek, userId, id, { ...payload, failedEvidence: evidence }) }),
          })
          .where(eq(receiptUploads.id, id));
      });
    },
  };
}
