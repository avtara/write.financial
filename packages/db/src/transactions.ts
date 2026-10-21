// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Confirmed transactions (FR-T1–T9, FR-L3–L6): record, read with everything the detail sheet shows, edit, soft
 * delete with Undo, duplicate, split, bulk edits, and attachments. Every method is one user transaction. Edits,
 * deletes, copies, and splits refuse the transactions a receivable or debt manages
 * ({@link assertUnmanagedTransactionsIn}).
 *
 * Deleting is soft (`deleted_at`): the row, its postings and attachments stay so Undo (`restore`) can bring them back;
 * maintenance purges deleted rows and their stored objects once the restore window ends.
 */
import { createHash } from 'node:crypto';
import { decryptText, encrypt } from '@wf/crypto/cipher';
import type { Dek } from '@wf/crypto/envelope';
import { formatRate, parseRate } from '@wf/domain/fx';
import type { LocalDate } from '@wf/domain/period';
import {
  assertSplit,
  MAX_TAGS_PER_TRANSACTION,
  SplitMismatchError,
  type PostingRole,
  type TransactionSource,
  type TransactionType,
} from '@wf/domain/transactions';
import { and, asc, eq, exists, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { firstRow, withUser, type Database, type Transaction } from './db.ts';
import { logActivity, type ActivityEntry } from './activity.ts';
import {
  assertOpenDatesIn,
  assertOpenTransactionsIn,
  checkCategoryIn,
  NOTE_PURPOSE,
  planTransactionIn,
  recordTransactionIn,
  resolveTagsIn,
  writeLinesIn,
  type EntryDraft,
  type RecordResult,
  type TransactionDraft,
} from './ledger-core.ts';
import { LedgerError } from './ledger-errors.ts';
import {
  accounts,
  activityLog,
  attachments,
  cardPaymentAllocations,
  debtInstallments,
  debts,
  postings,
  tags,
  transactions,
  transactionTags,
  transferMeta,
} from './schema.ts';

/** AAD purpose of `attachments.name_enc`. */
export const ATTACHMENT_NAME_PURPOSE = 'attachments.name';

export type AttachmentKind = (typeof attachments.$inferSelect)['kind'];

export interface PostingView {
  readonly id: string;
  readonly accountId: string;
  /** Signed, in `currency`. */
  readonly amountMinor: bigint;
  readonly currency: string;
  /** Canonical decimal string; `null` in the base currency. */
  readonly fxRateToBase: string | null;
  readonly amountBaseMinor: bigint;
  readonly role: PostingRole;
  readonly categoryId: string | null;
}

export interface TransferView {
  readonly sentMinor: bigint;
  readonly sentCurrency: string;
  readonly receivedMinor: bigint;
  readonly receivedCurrency: string;
  /** 1 `rateBase` = `referenceRate` `rateQuote`; all `null` within one currency. */
  readonly referenceRate: string | null;
  readonly rateBase: string | null;
  readonly rateQuote: string | null;
  /** `manual` or the built-in provider. */
  readonly rateSource: string | null;
  readonly rateAsOf: LocalDate | null;
  readonly fxDiffBaseMinor: bigint;
}

export interface AttachmentView {
  readonly id: string;
  readonly mime: string;
  readonly size: number;
  readonly kind: AttachmentKind;
  readonly objectKey: string;
  readonly thumbnailKey: string | null;
  /** SHA-256 of the `objectKey` plaintext, lowercase hex (the thumbnail has none). */
  readonly sha256: string;
  /** Original file name (decrypted). */
  readonly name: string | null;
  readonly createdAt: Date;
}

export interface TransactionDetail {
  readonly id: string;
  readonly type: TransactionType;
  readonly occurredAt: Date;
  readonly localDate: LocalDate;
  readonly description: string | null;
  readonly merchant: string | null;
  /** Decrypted. */
  readonly note: string | null;
  readonly categoryId: string | null;
  readonly source: TransactionSource;
  readonly splitParentId: string | null;
  readonly duplicatedFromId: string | null;
  readonly clientId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Set for soft-deleted rows (shown by Undo UIs). */
  readonly deletedAt: Date | null;
  /** Principal postings first (outgoing before incoming), then fee, FX difference, tax. */
  readonly postings: PostingView[];
  /** Slugs, sorted. */
  readonly tags: string[];
  readonly transfer: TransferView | null;
  readonly attachments: AttachmentView[];
  /** Oldest first. */
  readonly activity: ActivityEntry[];
}

export interface AttachmentInput {
  readonly bucket: string;
  /** `u/{userId}/{uuid}` of the encrypted object. */
  readonly objectKey: string;
  readonly thumbnailKey?: string | null;
  readonly mime: string;
  readonly size: number;
  /** SHA-256 of the plaintext, lowercase hex. */
  readonly sha256: string;
  readonly kind: AttachmentKind;
  /** Original file name; stored encrypted. */
  readonly name?: string | null;
}

export interface SplitPart {
  /** Positive, in the account currency. */
  readonly amountMinor: bigint;
  readonly categoryId: string | null;
  /** Omitted = the parent's description; `null` = none. */
  readonly description?: string | null;
}

export interface TransactionsRepository {
  /** Records a confirmed transaction; idempotent per `draft.clientId`. @throws {LedgerError} */
  create: (userId: string, draft: TransactionDraft) => Promise<RecordResult>;
  /** Also returns soft-deleted rows (with `deletedAt`). @throws {LedgerError} `NOT_FOUND` */
  get: (userId: string, id: string) => Promise<TransactionDetail>;
  /**
   * Replaces the transaction with `draft` (its `clientId` is ignored); logs the changed field names.
   * @throws {LedgerError} `NOT_FOUND` (also for deleted rows) and the validation codes of `create`
   */
  update: (userId: string, id: string, draft: TransactionDraft) => Promise<TransactionDetail>;
  /** Soft-deletes the live rows among `ids` (others are ignored); returns the ids deleted. */
  remove: (userId: string, ids: readonly string[]) => Promise<{ deleted: string[] }>;
  /** Undo of {@link remove}: brings the deleted rows among `ids` back. */
  restore: (userId: string, ids: readonly string[]) => Promise<{ restored: string[] }>;
  /**
   * FR-L6: a copy dated now with the same accounts, amounts, category, tags, and note (not the attachments); a
   * transfer keeps a manual rate and its fee. Idempotent per `clientId`.
   * @throws {LedgerError} `NOT_FOUND`, `INVALID_TRANSACTION` (types other than expense/income/transfer)
   */
  duplicate: (userId: string, id: string, options: { clientId: string }) => Promise<RecordResult>;
  /**
   * FR-L5: replaces an expense or income with parts on the same account, date, merchant, note, tags and source
   * (each with its own category and amount, adding up to the total); the parts share the parent's attachments and
   * the parent is soft-deleted. Idempotent per `clientId` (part client ids are derived from it). Undo: `unsplit`.
   * @throws {LedgerError} `NOT_FOUND`, `INVALID_TRANSACTION`, `SPLIT_MISMATCH`, category codes
   */
  split: (
    userId: string,
    id: string,
    options: { clientId: string; parts: readonly SplitPart[] },
  ) => Promise<{ partIds: string[] }>;
  /**
   * Undo of {@link split}: restores the deleted parent and soft-deletes its live parts (= `restore(parent)` +
   * `remove(parts)` in one transaction). Returns the parts removed.
   * @throws {LedgerError} `NOT_FOUND` when `parentId` is not a deleted transaction
   */
  unsplit: (userId: string, parentId: string) => Promise<{ partIds: string[] }>;
  /**
   * FR-L3: sets the category of the live expenses/incomes among `ids`; returns the rows that changed.
   * @throws {LedgerError} `INVALID_TRANSACTION` (a transfer is selected), `CATEGORY_KIND_MISMATCH`, category codes
   */
  bulkSetCategory: (
    userId: string,
    ids: readonly string[],
    categoryId: string | null,
  ) => Promise<{ updated: string[] }>;
  /**
   * FR-L3: moves expenses/incomes to `accountId` (same currency only, amounts are kept); returns the rows moved.
   * @throws {LedgerError} `NOT_FOUND`, `ACCOUNT_ARCHIVED`, `INVALID_TRANSACTION` (a transfer or another currency)
   */
  bulkMoveAccount: (userId: string, ids: readonly string[], accountId: string) => Promise<{ updated: string[] }>;
  /**
   * FR-L3: adds `tag` to the live rows among `ids` that lack it; returns those rows.
   * @throws {LedgerError} `INVALID_TAG`, `TOO_MANY_TAGS` (for the whole operation, when a row already has five)
   */
  bulkAddTag: (userId: string, ids: readonly string[], tag: string) => Promise<{ updated: string[] }>;
  /** @throws {LedgerError} `NOT_FOUND` (also for deleted transactions) */
  addAttachment: (userId: string, transactionId: string, input: AttachmentInput) => Promise<{ id: string }>;
  /**
   * Deletes the attachment row and returns the object and thumbnail keys no other row references (split parts
   * share objects), which the caller deletes from storage.
   * @throws {LedgerError} `NOT_FOUND`
   */
  removeAttachment: (userId: string, attachmentId: string) => Promise<{ objectKeys: string[] }>;
}

const HEADER = {
  id: transactions.id,
  type: transactions.type,
  occurredAt: transactions.occurredAt,
  localDate: transactions.localDate,
  description: transactions.description,
  merchant: transactions.merchant,
  noteEnc: transactions.noteEnc,
  categoryId: transactions.categoryId,
  source: transactions.source,
  splitParentId: transactions.splitParentId,
  duplicatedFromId: transactions.duplicatedFromId,
  clientId: transactions.clientId,
  createdAt: transactions.createdAt,
  updatedAt: transactions.updatedAt,
  deletedAt: transactions.deletedAt,
};

type Header = Pick<typeof transactions.$inferSelect, keyof typeof HEADER>;
type EntryType = EntryDraft['type'];

interface StoredDetail {
  readonly header: Header;
  readonly postings: PostingView[];
  readonly tags: string[];
  readonly transfer: TransferView | null;
  readonly attachments: (Omit<AttachmentView, 'name'> & { readonly nameEnc: Uint8Array | null })[];
  readonly activity: ActivityEntry[];
}

function isEntry(type: TransactionType): type is EntryType {
  return type === 'expense' || type === 'income';
}

/** Canonical form of a `numeric` rate column (`16350.02750000` → `16350.0275`). */
function canonicalRate(value: string | null): string | null {
  return value === null ? null : formatRate(parseRate(value));
}

/** What counts as an amount or account change of an edit: the lines without their derived base values. */
function linesKey(
  lines: readonly { accountId: string; amountMinor: bigint; role: string; categoryId: string | null }[],
) {
  return lines
    .map((line) => `${line.role}:${line.accountId}:${line.amountMinor}:${line.categoryId}`)
    .sort()
    .join();
}

/** Client id of split part `index`: a UUID v5 in the namespace of the split's client id (stable across retries). */
function partClientId(clientId: string, index: number): string {
  const hash = createHash('sha1')
    .update(Buffer.from(clientId.replaceAll('-', ''), 'hex'))
    .update(`split:${index}`)
    .digest();
  hash.writeUInt8((hash.readUInt8(6) & 0x0f) | 0x50, 6);
  hash.writeUInt8((hash.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function liveHeaderIn(tx: Transaction, id: string) {
  const [row] = await tx
    .select(HEADER)
    .from(transactions)
    .where(and(eq(transactions.id, id), isNull(transactions.deletedAt)));
  if (row === undefined) throw new LedgerError('NOT_FOUND', 'No such transaction');
  return row;
}

/** Transaction types only their receivable writes (FR-U7). */
const RECEIVABLE_TYPES: TransactionType[] = ['receivable_out', 'receivable_in', 'writeoff'];

/**
 * Refuses transactions another repository manages, which change only through it: a receivable's lending,
 * repayments, and write-off (FR-U7), a debt installment's payment, a card expense turned into an installment plan
 * (FR-U2), and a card payment allocated to its buckets (FR-U4). Soft-deleted rows among `ids` count too.
 * @throws {LedgerError} `INVALID_TRANSACTION`
 */
export async function assertUnmanagedTransactionsIn(tx: Transaction, ids: readonly string[]): Promise<void> {
  const [managed] = await tx
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        inArray(transactions.id, [...ids]),
        or(
          inArray(transactions.type, RECEIVABLE_TYPES),
          exists(
            tx
              .select({ id: debtInstallments.id })
              .from(debtInstallments)
              .where(eq(debtInstallments.transactionId, transactions.id)),
          ),
          exists(tx.select({ id: debts.id }).from(debts).where(eq(debts.sourceTransactionId, transactions.id))),
          exists(
            tx
              .select({ id: cardPaymentAllocations.id })
              .from(cardPaymentAllocations)
              .where(eq(cardPaymentAllocations.transactionId, transactions.id)),
          ),
        ),
      ),
    )
    .limit(1);
  if (managed !== undefined) {
    throw new LedgerError('INVALID_TRANSACTION', 'The transaction is managed by its receivable or debt');
  }
}

async function tagSlugsIn(tx: Transaction, transactionId: string): Promise<string[]> {
  const rows = await tx
    .select({ slug: tags.slug })
    .from(transactionTags)
    .innerJoin(tags, eq(tags.id, transactionTags.tagId))
    .where(eq(transactionTags.transactionId, transactionId))
    .orderBy(asc(tags.slug));
  return rows.map((row) => row.slug);
}

async function loadIn(tx: Transaction, id: string): Promise<StoredDetail> {
  const [header] = await tx.select(HEADER).from(transactions).where(eq(transactions.id, id));
  if (header === undefined) throw new LedgerError('NOT_FOUND', 'No such transaction');
  const lines = await tx
    .select({
      id: postings.id,
      accountId: postings.accountId,
      amountMinor: postings.amountMinor,
      currency: postings.currency,
      fxRateToBase: postings.fxRateToBase,
      amountBaseMinor: postings.amountBaseMinor,
      role: postings.role,
      categoryId: postings.categoryId,
    })
    .from(postings)
    .where(eq(postings.transactionId, id))
    .orderBy(asc(postings.role), asc(postings.amountMinor), asc(postings.id));
  const [meta] = await tx
    .select({
      sentMinor: transferMeta.sentMinor,
      sentCurrency: transferMeta.sentCurrency,
      receivedMinor: transferMeta.receivedMinor,
      receivedCurrency: transferMeta.receivedCurrency,
      referenceRate: transferMeta.referenceRate,
      rateBase: transferMeta.rateBase,
      rateQuote: transferMeta.rateQuote,
      rateSource: transferMeta.rateSource,
      rateAsOf: transferMeta.rateAsOf,
      fxDiffBaseMinor: transferMeta.fxDiffBaseMinor,
    })
    .from(transferMeta)
    .where(eq(transferMeta.transactionId, id));
  const files = await tx
    .select({
      id: attachments.id,
      mime: attachments.mime,
      size: attachments.size,
      kind: attachments.kind,
      objectKey: attachments.objectKey,
      thumbnailKey: attachments.thumbnailKey,
      sha256: attachments.sha256,
      nameEnc: attachments.nameEnc,
      createdAt: attachments.createdAt,
    })
    .from(attachments)
    .where(eq(attachments.transactionId, id))
    .orderBy(asc(attachments.createdAt), asc(attachments.id));
  const activity = await tx
    .select({ action: activityLog.action, meta: activityLog.meta, at: activityLog.at })
    .from(activityLog)
    .where(and(eq(activityLog.entity, 'transaction'), eq(activityLog.entityId, id)))
    .orderBy(asc(activityLog.at), asc(activityLog.id));
  return {
    header,
    postings: lines.map((line) => ({ ...line, fxRateToBase: canonicalRate(line.fxRateToBase) })),
    tags: await tagSlugsIn(tx, id),
    transfer: meta === undefined ? null : { ...meta, referenceRate: canonicalRate(meta.referenceRate) },
    attachments: files,
    activity,
  };
}

/** An expense/income as a draft (no note: callers copy `note_enc` as is), for re-planning or copying. */
async function entryDraftIn(tx: Transaction, header: Header, type: EntryType): Promise<EntryDraft> {
  const principal = firstRow(
    await tx
      .select({ accountId: postings.accountId, amountMinor: postings.amountMinor })
      .from(postings)
      .where(and(eq(postings.transactionId, header.id), eq(postings.role, 'principal'))),
    'postings',
  );
  return {
    type,
    clientId: header.clientId,
    occurredAt: header.occurredAt,
    accountId: principal.accountId,
    amountMinor: type === 'expense' ? -principal.amountMinor : principal.amountMinor,
    categoryId: header.categoryId,
    description: header.description,
    merchant: header.merchant,
    tags: await tagSlugsIn(tx, header.id),
    source: header.source,
  };
}

/** A transfer as a draft: same legs, the manual rate if one was used, and the fee from the fee posting. */
async function transferDraftIn(tx: Transaction, header: Header): Promise<TransactionDraft> {
  const lines = await tx
    .select({
      accountId: postings.accountId,
      amountMinor: postings.amountMinor,
      role: postings.role,
      categoryId: postings.categoryId,
    })
    .from(postings)
    .where(eq(postings.transactionId, header.id));
  const meta = firstRow(
    await tx.select().from(transferMeta).where(eq(transferMeta.transactionId, header.id)),
    'transfer_meta',
  );
  const from = firstRow(
    lines.filter((line) => line.role === 'principal' && line.amountMinor < 0n),
    'postings',
  );
  const to = firstRow(
    lines.filter((line) => line.role === 'principal' && line.amountMinor > 0n),
    'postings',
  );
  const [fee] = lines.filter((line) => line.role === 'fee');
  // The rate check constraint makes rate, base and quote non-null together, and rate_source is set with them.
  const manualRate =
    meta.rateSource === 'manual'
      ? {
          base: meta.rateBase as string,
          quote: meta.rateQuote as string,
          rate: canonicalRate(meta.referenceRate) as string,
        }
      : null;
  return {
    type: 'transfer',
    clientId: header.clientId,
    occurredAt: header.occurredAt,
    fromAccountId: from.accountId,
    toAccountId: to.accountId,
    sentMinor: meta.sentMinor,
    receivedMinor: meta.receivedMinor,
    manualRate,
    fee: fee === undefined ? null : { minor: -fee.amountMinor, categoryId: fee.categoryId as string },
    description: header.description,
    merchant: header.merchant,
    tags: await tagSlugsIn(tx, header.id),
    source: header.source,
  };
}

export function createTransactions(
  db: Database,
  { getDek, now = () => new Date() }: { getDek: (userId: string) => Promise<Dek>; now?: () => Date },
): TransactionsRepository {
  /** Decrypts a stored detail; the DEK is fetched (outside any open transaction) only when something is encrypted. */
  async function reveal(userId: string, stored: StoredDetail, dek: Dek | null): Promise<TransactionDetail> {
    const { noteEnc, ...header } = stored.header;
    const encrypted = noteEnc !== null || stored.attachments.some((file) => file.nameEnc !== null);
    const key = encrypted ? (dek ?? (await getDek(userId))) : null;
    const open = (blob: Uint8Array | null, purpose: string) =>
      blob === null ? null : decryptText(key as Dek, blob, { userId, purpose });
    return {
      ...header,
      note: open(noteEnc, NOTE_PURPOSE),
      postings: stored.postings,
      tags: stored.tags,
      transfer: stored.transfer,
      attachments: stored.attachments.map(({ nameEnc, ...file }) => ({
        ...file,
        name: open(nameEnc, ATTACHMENT_NAME_PURPOSE),
      })),
      activity: stored.activity,
    };
  }

  return {
    create: async (userId, draft) => {
      const dek = (draft.note?.trim() ?? '') === '' ? null : await getDek(userId);
      return withUser(db, userId, (tx) => recordTransactionIn(tx, userId, draft, dek, now()));
    },

    get: async (userId, id) => reveal(userId, await withUser(db, userId, (tx) => loadIn(tx, id)), null),

    update: async (userId, id, draft) => {
      // Always needed: the old note is compared to the new one.
      const dek = await getDek(userId);
      const stored = await withUser(db, userId, async (tx) => {
        const before = await liveHeaderIn(tx, id);
        await assertUnmanagedTransactionsIn(tx, [id]);
        await assertOpenDatesIn(tx, [before.localDate]);
        const beforeLines = await tx
          .select({
            accountId: postings.accountId,
            amountMinor: postings.amountMinor,
            role: postings.role,
            categoryId: postings.categoryId,
          })
          .from(postings)
          .where(eq(postings.transactionId, id));
        const beforeTags = await tagSlugsIn(tx, id);
        const plan = await planTransactionIn(tx, userId, draft, dek);
        await tx
          .update(transactions)
          .set({ ...plan.header, updatedAt: now() })
          .where(eq(transactions.id, id));
        await writeLinesIn(tx, userId, id, plan);
        const { header } = plan;
        const compared: Record<string, readonly [unknown, unknown]> = {
          type: [before.type, header.type],
          occurredAt: [before.occurredAt.getTime(), header.occurredAt.getTime()],
          description: [before.description, header.description],
          merchant: [before.merchant, header.merchant],
          note: [
            before.noteEnc === null ? null : decryptText(dek, before.noteEnc, { userId, purpose: NOTE_PURPOSE }),
            draft.note?.trim() || null,
          ],
          categoryId: [before.categoryId, header.categoryId],
          source: [before.source, header.source],
          amounts: [linesKey(beforeLines), linesKey(plan.postings)],
          tags: [beforeTags.join(), (await tagSlugsIn(tx, id)).join()],
        };
        const fields = Object.entries(compared)
          .filter(([, [old, next]]) => old !== next)
          .map(([field]) => field);
        await logActivity(tx, userId, 'transaction', [id], 'updated', { fields });
        return loadIn(tx, id);
      });
      return reveal(userId, stored, dek);
    },

    remove: (userId, ids) =>
      withUser(db, userId, async (tx) => {
        await assertOpenTransactionsIn(tx, ids);
        await assertUnmanagedTransactionsIn(tx, ids);
        const rows = await tx
          .update(transactions)
          .set({ deletedAt: now() })
          .where(and(inArray(transactions.id, [...ids]), isNull(transactions.deletedAt)))
          .returning({ id: transactions.id });
        const deleted = rows.map((row) => row.id);
        await logActivity(tx, userId, 'transaction', deleted, 'deleted');
        return { deleted };
      }),

    restore: (userId, ids) =>
      withUser(db, userId, async (tx) => {
        await assertOpenTransactionsIn(tx, ids);
        const rows = await tx
          .update(transactions)
          .set({ deletedAt: null })
          .where(and(inArray(transactions.id, [...ids]), isNotNull(transactions.deletedAt)))
          .returning({ id: transactions.id });
        const restored = rows.map((row) => row.id);
        await logActivity(tx, userId, 'transaction', restored, 'restored');
        return { restored };
      }),

    duplicate: (userId, id, { clientId }) =>
      withUser(db, userId, async (tx) => {
        const source = await liveHeaderIn(tx, id);
        await assertUnmanagedTransactionsIn(tx, [id]);
        const { type } = source;
        let draft: TransactionDraft;
        if (isEntry(type)) draft = await entryDraftIn(tx, source, type);
        else if (type === 'transfer') draft = await transferDraftIn(tx, source);
        else throw new LedgerError('INVALID_TRANSACTION', `A ${type} transaction cannot be duplicated`);
        const at = now();
        const result = await recordTransactionIn(
          tx,
          userId,
          { ...draft, clientId, occurredAt: at, duplicatedFromId: id },
          null,
          at,
        );
        if (result.created) {
          // The note ciphertext is bound to the user and column only, so the copy can reuse it without the DEK.
          await tx.update(transactions).set({ noteEnc: source.noteEnc }).where(eq(transactions.id, result.id));
          await logActivity(tx, userId, 'transaction', [id], 'duplicated', { copy: result.id });
        }
        return result;
      }),

    split: (userId, id, { clientId, parts }) =>
      withUser(db, userId, async (tx) => {
        const partClientIds = parts.map((_, index) => partClientId(clientId, index));
        const replayed = await tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(inArray(transactions.clientId, partClientIds))
          .orderBy(asc(transactions.id));
        if (replayed.length > 0) return { partIds: replayed.map((row) => row.id) };

        const parent = await liveHeaderIn(tx, id);
        await assertUnmanagedTransactionsIn(tx, [id]);
        const { type } = parent;
        if (!isEntry(type)) throw new LedgerError('INVALID_TRANSACTION', 'Only an expense or income can be split');
        const base = await entryDraftIn(tx, parent, type);
        try {
          assertSplit(
            base.amountMinor,
            parts.map((part) => part.amountMinor),
          );
        } catch (error) {
          // Messages without amounts.
          throw error instanceof SplitMismatchError
            ? new LedgerError('SPLIT_MISMATCH')
            : new LedgerError('INVALID_TRANSACTION', 'A split needs at least two positive parts');
        }
        const at = now();
        const partIds: string[] = [];
        for (const [index, part] of parts.entries()) {
          const draft: EntryDraft = {
            ...base,
            clientId: partClientId(clientId, index),
            amountMinor: part.amountMinor,
            categoryId: part.categoryId,
            ...(part.description === undefined ? {} : { description: part.description }),
            splitParentId: id,
          };
          partIds.push((await recordTransactionIn(tx, userId, draft, null, at)).id);
        }
        await tx.update(transactions).set({ noteEnc: parent.noteEnc }).where(inArray(transactions.id, partIds));
        // New rows sharing the parent's stored objects (removeAttachment releases a key with its last row).
        const files = await tx
          .select({
            userId: attachments.userId,
            bucket: attachments.bucket,
            objectKey: attachments.objectKey,
            thumbnailKey: attachments.thumbnailKey,
            mime: attachments.mime,
            size: attachments.size,
            sha256: attachments.sha256,
            kind: attachments.kind,
            nameEnc: attachments.nameEnc,
            ocrEnc: attachments.ocrEnc,
          })
          .from(attachments)
          .where(eq(attachments.transactionId, id));
        if (files.length > 0) {
          await tx
            .insert(attachments)
            .values(partIds.flatMap((transactionId) => files.map((file) => ({ ...file, transactionId }))));
        }
        await tx.update(transactions).set({ deletedAt: at }).where(eq(transactions.id, id));
        await logActivity(tx, userId, 'transaction', [id], 'split', { parts: partIds });
        return { partIds };
      }),

    unsplit: (userId, parentId) =>
      withUser(db, userId, async (tx) => {
        await assertOpenTransactionsIn(tx, [parentId]);
        await assertUnmanagedTransactionsIn(tx, [parentId]);
        const restored = await tx
          .update(transactions)
          .set({ deletedAt: null })
          .where(and(eq(transactions.id, parentId), isNotNull(transactions.deletedAt)))
          .returning({ id: transactions.id });
        if (restored.length === 0) throw new LedgerError('NOT_FOUND', 'No such deleted transaction');
        const parts = await tx
          .update(transactions)
          .set({ deletedAt: now() })
          .where(and(eq(transactions.splitParentId, parentId), isNull(transactions.deletedAt)))
          .returning({ id: transactions.id });
        const partIds = parts.map((row) => row.id);
        await logActivity(tx, userId, 'transaction', [parentId], 'restored');
        await logActivity(tx, userId, 'transaction', partIds, 'deleted');
        return { partIds };
      }),

    bulkSetCategory: (userId, ids, categoryId) =>
      withUser(db, userId, async (tx) => {
        await assertOpenTransactionsIn(tx, ids);
        await assertUnmanagedTransactionsIn(tx, ids);
        const rows = await tx
          .select({ id: transactions.id, type: transactions.type, categoryId: transactions.categoryId })
          .from(transactions)
          .where(and(inArray(transactions.id, [...ids]), isNull(transactions.deletedAt)))
          .orderBy(asc(transactions.id));
        const types = new Set<EntryType>();
        for (const { type } of rows) {
          if (!isEntry(type)) throw new LedgerError('INVALID_TRANSACTION', 'Only expenses and incomes have a category');
          types.add(type);
        }
        if (categoryId !== null) for (const type of types) await checkCategoryIn(tx, categoryId, type);
        const updated = rows.filter((row) => row.categoryId !== categoryId).map((row) => row.id);
        await tx.update(transactions).set({ categoryId, updatedAt: now() }).where(inArray(transactions.id, updated));
        await logActivity(tx, userId, 'transaction', updated, 'updated', { fields: ['categoryId'], bulk: true });
        return { updated };
      }),

    bulkMoveAccount: (userId, ids, accountId) =>
      withUser(db, userId, async (tx) => {
        const [account] = await tx
          .select({ currency: accounts.currency })
          .from(accounts)
          .where(eq(accounts.id, accountId));
        if (account === undefined) throw new LedgerError('NOT_FOUND', 'No such account');
        await assertUnmanagedTransactionsIn(tx, ids);
        const rows = await tx
          .select({ ...HEADER, principalAccountId: postings.accountId, currency: postings.currency })
          .from(transactions)
          .innerJoin(postings, and(eq(postings.transactionId, transactions.id), eq(postings.role, 'principal')))
          .where(and(inArray(transactions.id, [...ids]), isNull(transactions.deletedAt)))
          .orderBy(asc(transactions.id));
        const updated: string[] = [];
        for (const { principalAccountId, currency, ...row } of rows) {
          const { type } = row;
          if (!isEntry(type)) throw new LedgerError('INVALID_TRANSACTION', 'A transfer cannot be moved in bulk');
          if (currency !== account.currency) {
            throw new LedgerError('INVALID_TRANSACTION', 'The account has another currency');
          }
          if (principalAccountId === accountId) continue;
          const draft = await entryDraftIn(tx, row, type);
          await writeLinesIn(tx, userId, row.id, await planTransactionIn(tx, userId, { ...draft, accountId }, null));
          updated.push(row.id);
        }
        await tx.update(transactions).set({ updatedAt: now() }).where(inArray(transactions.id, updated));
        await logActivity(tx, userId, 'transaction', updated, 'updated', { fields: ['accountId'], bulk: true });
        return { updated };
      }),

    bulkAddTag: (userId, ids, tag) =>
      withUser(db, userId, async (tx) => {
        await assertOpenTransactionsIn(tx, ids);
        const [tagId] = (await resolveTagsIn(tx, userId, [tag])) as [string];
        const rows = await tx
          .select({
            id: transactions.id,
            count: sql<number>`count(${transactionTags.tagId})::int`,
            tagged: sql<boolean>`coalesce(bool_or(${transactionTags.tagId} = ${tagId}), false)`,
          })
          .from(transactions)
          .leftJoin(transactionTags, eq(transactionTags.transactionId, transactions.id))
          .where(and(inArray(transactions.id, [...ids]), isNull(transactions.deletedAt)))
          .groupBy(transactions.id)
          .orderBy(asc(transactions.id));
        const targets = rows.filter((row) => !row.tagged);
        if (targets.some((row) => row.count >= MAX_TAGS_PER_TRANSACTION)) throw new LedgerError('TOO_MANY_TAGS');
        const updated = targets.map((row) => row.id);
        if (updated.length > 0) {
          await tx.insert(transactionTags).values(updated.map((transactionId) => ({ userId, transactionId, tagId })));
          await tx.update(transactions).set({ updatedAt: now() }).where(inArray(transactions.id, updated));
        }
        await logActivity(tx, userId, 'transaction', updated, 'updated', { fields: ['tags'], bulk: true });
        return { updated };
      }),

    addAttachment: async (userId, transactionId, input) => {
      const name = input.name?.trim() || null;
      const nameEnc =
        name === null ? null : encrypt(await getDek(userId), name, { userId, purpose: ATTACHMENT_NAME_PURPOSE });
      return withUser(db, userId, async (tx) => {
        await liveHeaderIn(tx, transactionId);
        const rows = await tx
          .insert(attachments)
          .values({
            userId,
            transactionId,
            bucket: input.bucket,
            objectKey: input.objectKey,
            thumbnailKey: input.thumbnailKey ?? null,
            mime: input.mime,
            size: input.size,
            sha256: input.sha256,
            kind: input.kind,
            nameEnc,
          })
          .returning({ id: attachments.id });
        await logActivity(tx, userId, 'transaction', [transactionId], 'updated', { fields: ['attachments'] });
        return firstRow(rows, 'attachments');
      });
    },

    removeAttachment: (userId, attachmentId) =>
      withUser(db, userId, async (tx) => {
        const [row] = await tx.delete(attachments).where(eq(attachments.id, attachmentId)).returning({
          transactionId: attachments.transactionId,
          objectKey: attachments.objectKey,
          thumbnailKey: attachments.thumbnailKey,
        });
        if (row === undefined) throw new LedgerError('NOT_FOUND', 'No such attachment');
        const keys = row.thumbnailKey === null ? [row.objectKey] : [row.objectKey, row.thumbnailKey];
        const others = await tx
          .select({ objectKey: attachments.objectKey, thumbnailKey: attachments.thumbnailKey })
          .from(attachments)
          .where(or(inArray(attachments.objectKey, keys), inArray(attachments.thumbnailKey, keys)));
        const referenced = new Set(others.flatMap((other) => [other.objectKey, other.thumbnailKey]));
        await logActivity(tx, userId, 'transaction', [row.transactionId], 'updated', { fields: ['attachments'] });
        return { objectKeys: keys.filter((key) => !referenced.has(key)) };
      }),
  };
}
