// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Building blocks shared by the ledger repositories, all running inside the caller's `withUser` transaction: the
 * user's base currency and time zone, rates for valuation, built-in categories, tags, and turning a transaction
 * draft into a header + postings (`@wf/domain/transactions`) and writing it.
 */
import { encrypt } from '@wf/crypto/cipher';
import type { Dek } from '@wf/crypto/envelope';
import { BUILT_IN_CATEGORIES, FX_DIFFERENCE_CATEGORY, type BuiltInCategoryKey } from '@wf/domain/categories';
import { MissingRateError, type FxDifference, type FxRate } from '@wf/domain/fx';
import type { LocalDate } from '@wf/domain/period';
import { normalizeTagSlug } from '@wf/domain/tags';
import {
  expensePostings,
  incomePostings,
  MAX_TAGS_PER_TRANSACTION,
  NonPositiveAmountError,
  SameAccountTransferError,
  transferPostings,
  type PostingDraft,
  type TransactionSource,
  type Valuation,
} from '@wf/domain/transactions';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { firstRow, type Transaction } from './db.ts';
import { logActivity } from './activity.ts';
import { referenceRateIn } from './fx-rates.ts';
import { LedgerError } from './ledger-errors.ts';
import {
  accounts,
  categories,
  postings,
  tagAliases,
  tags,
  transactions,
  transactionTags,
  transferMeta,
  users,
} from './schema.ts';

/** AAD purpose of `transactions.note_enc`. */
export const NOTE_PURPOSE = 'transactions.note';

export interface UserContext {
  readonly baseCurrency: string;
  readonly timezone: string;
}

export async function userContextIn(tx: Transaction, userId: string): Promise<UserContext> {
  const rows = await tx
    .select({ baseCurrency: users.baseCurrency, timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId));
  return firstRow(rows, 'users');
}

/** The calendar date of `at` in `timezone` (`YYYY-MM-DD`). */
export function localDateOf(at: Date, timezone: string): LocalDate {
  // en-CA formats dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(at) as LocalDate;
}

/**
 * Rates from each of `currencies` to the base currency (reference resolution: manual → built-in), as of `asOf`.
 * @throws {LedgerError} `FX_RATE_MISSING` when a currency has no rate.
 */
export async function valuationIn(
  tx: Transaction,
  baseCurrency: string,
  currencies: Iterable<string>,
  asOf?: LocalDate,
): Promise<Valuation> {
  const rates: FxRate[] = [];
  for (const currency of new Set(currencies)) {
    if (currency === baseCurrency) continue;
    // A rate dated after the transaction is better than none (e.g. backdated entries before the first fetch).
    const rate =
      (await referenceRateIn(tx, currency, baseCurrency, asOf)) ?? (await referenceRateIn(tx, currency, baseCurrency));
    if (rate === null) throw new LedgerError('FX_RATE_MISSING', `No rate for ${currency}`);
    rates.push(rate);
  }
  return { baseCurrency, rates };
}

/** The id of the user's live built-in category `key`, created from the catalog on first use. */
export async function builtInCategoryIn(tx: Transaction, userId: string, key: BuiltInCategoryKey): Promise<string> {
  const entry = BUILT_IN_CATEGORIES.find((category) => category.key === key);
  if (entry === undefined) throw new LedgerError('NOT_FOUND', `Unknown built-in category ${key}`);
  const find = () =>
    tx
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.kind, entry.kind), eq(categories.name, key), isNull(categories.deletedAt)));
  const [existing] = await find();
  if (existing !== undefined) return existing.id;
  await tx
    .insert(categories)
    .values({
      userId,
      kind: entry.kind,
      group: entry.group,
      name: key,
      icon: entry.icon,
      color: entry.color,
      isFixed: entry.isFixed,
      isSystem: entry.isSystem,
      sortOrder: BUILT_IN_CATEGORIES.indexOf(entry),
    })
    .onConflictDoNothing();
  return firstRow(await find(), 'categories').id;
}

/**
 * Tag ids for user input (`#Dana Darurat`, `dana-darurat`, …): normalized, de-duplicated, aliases resolved to the
 * tag they were merged into, missing tags created.
 * @throws {LedgerError} `INVALID_TAG`, `TOO_MANY_TAGS`
 */
export async function resolveTagsIn(tx: Transaction, userId: string, inputs: readonly string[]): Promise<string[]> {
  const slugs = [
    ...new Set(
      inputs.map((input) => {
        const slug = normalizeTagSlug(input);
        if (slug === null) throw new LedgerError('INVALID_TAG', 'A tag must contain a letter or digit');
        return slug;
      }),
    ),
  ];
  if (slugs.length > MAX_TAGS_PER_TRANSACTION) throw new LedgerError('TOO_MANY_TAGS');
  if (slugs.length === 0) return [];
  const aliases = await tx
    .select({ slug: tagAliases.slug, tagId: tagAliases.tagId })
    .from(tagAliases)
    .where(inArray(tagAliases.slug, slugs));
  const aliasedSlugs = new Set(aliases.map((alias) => alias.slug));
  const plain = slugs.filter((slug) => !aliasedSlugs.has(slug));
  if (plain.length > 0) {
    await tx
      .insert(tags)
      .values(plain.map((slug) => ({ userId, slug })))
      .onConflictDoNothing();
  }
  const found = plain.length === 0 ? [] : await tx.select({ id: tags.id }).from(tags).where(inArray(tags.slug, plain));
  // An alias and its tag's own slug may both be given: they resolve to one id.
  return [...new Set([...aliases.map((alias) => alias.tagId), ...found.map((tag) => tag.id)])];
}

/** Replaces the transaction's tags. */
export async function setTransactionTagsIn(
  tx: Transaction,
  userId: string,
  transactionId: string,
  tagIds: readonly string[],
): Promise<void> {
  await tx.delete(transactionTags).where(eq(transactionTags.transactionId, transactionId));
  if (tagIds.length > 0) {
    await tx.insert(transactionTags).values(tagIds.map((tagId) => ({ userId, transactionId, tagId })));
  }
}

interface DraftCommon {
  /** Idempotency key of the form submission (NFR): a retry with the same id returns the first result. */
  readonly clientId: string;
  readonly occurredAt: Date;
  readonly description?: string | null;
  readonly merchant?: string | null;
  /** Plain text; stored encrypted (`note_enc`). */
  readonly note?: string | null;
  /** Tag input (slugs or `#Names`), at most five. */
  readonly tags?: readonly string[];
  readonly source?: TransactionSource;
  readonly splitParentId?: string | null;
  readonly duplicatedFromId?: string | null;
}

/** An expense or income on one account (FR-T1/T2). */
export interface EntryDraft extends DraftCommon {
  readonly type: 'expense' | 'income';
  readonly accountId: string;
  /** Positive, in the account currency. */
  readonly amountMinor: bigint;
  /** `null` = uncategorized ("Perlu kategori"). */
  readonly categoryId: string | null;
}

/** A transfer between two own accounts (FR-T4). */
export interface TransferDraft extends DraftCommon {
  readonly type: 'transfer';
  readonly fromAccountId: string;
  readonly toAccountId: string;
  /** Positive, in the source account's currency. */
  readonly sentMinor: bigint;
  /** Positive, in the destination account's currency ("Diterima"); equal to `sentMinor` within one currency. */
  readonly receivedMinor: bigint;
  /** Manual rate (Acuan/Manual toggle); otherwise the reference rate between the two currencies is used. */
  readonly manualRate?: FxRate | null;
  /** Transfer fee from the source account, recorded as an expense in a fee category. */
  readonly fee?: { readonly minor: bigint; readonly categoryId: string } | null;
}

export type TransactionDraft = EntryDraft | TransferDraft;

/** A draft resolved against the database, ready to be written. */
export interface TransactionPlan {
  readonly header: {
    readonly type: TransactionDraft['type'];
    readonly occurredAt: Date;
    readonly localDate: LocalDate;
    readonly description: string | null;
    readonly merchant: string | null;
    readonly noteEnc: Uint8Array | null;
    readonly categoryId: string | null;
    readonly source: TransactionSource;
  };
  readonly postings: readonly PostingDraft[];
  readonly transferMeta: Omit<typeof transferMeta.$inferInsert, 'transactionId' | 'userId'> | null;
  readonly tagIds: readonly string[];
  readonly fxDifference: FxDifference | null;
}

interface AccountRow {
  readonly id: string;
  readonly currency: string;
  readonly status: 'active' | 'archived';
}

async function accountsIn(tx: Transaction, ids: readonly string[]): Promise<Map<string, AccountRow>> {
  const rows = await tx
    .select({ id: accounts.id, currency: accounts.currency, status: accounts.status })
    .from(accounts)
    .where(inArray(accounts.id, [...ids]));
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const id of ids) {
    const row = byId.get(id);
    if (row === undefined) throw new LedgerError('NOT_FOUND', 'No such account');
    if (row.status === 'archived') throw new LedgerError('ACCOUNT_ARCHIVED');
  }
  return byId;
}

/** Checks that `categoryId` is a live, active category whose kind fits `use`. */
export async function checkCategoryIn(
  tx: Transaction,
  categoryId: string,
  use: 'expense' | 'income' | 'fee',
): Promise<void> {
  const [row] = await tx
    .select({ kind: categories.kind, archivedAt: categories.archivedAt })
    .from(categories)
    .where(and(eq(categories.id, categoryId), isNull(categories.deletedAt)));
  if (row === undefined) throw new LedgerError('NOT_FOUND', 'No such category');
  if (row.archivedAt !== null) throw new LedgerError('INVALID_CATEGORY', 'The category is archived');
  const allowed = use === 'income' ? row.kind === 'income' : row.kind !== 'income';
  if (!allowed) throw new LedgerError('CATEGORY_KIND_MISMATCH');
}

/** Domain validation errors become `INVALID_TRANSACTION`; a missing rate becomes `FX_RATE_MISSING`. */
function domainError(error: unknown): unknown {
  if (error instanceof NonPositiveAmountError || error instanceof SameAccountTransferError) {
    return new LedgerError('INVALID_TRANSACTION', error.message);
  }
  if (error instanceof MissingRateError) return new LedgerError('FX_RATE_MISSING', error.message);
  if (error instanceof RangeError) return new LedgerError('INVALID_TRANSACTION', error.message);
  return error;
}

/**
 * Validates `draft` and computes its postings. `dek` must be given when the draft has a note.
 * @throws {LedgerError}
 */
export async function planTransactionIn(
  tx: Transaction,
  userId: string,
  draft: TransactionDraft,
  dek: Dek | null,
): Promise<TransactionPlan> {
  const context = await userContextIn(tx, userId);
  const localDate = localDateOf(draft.occurredAt, context.timezone);
  const note = draft.note?.trim() ?? '';
  if (note !== '' && dek === null) throw new TypeError('A note needs the user DEK');
  const noteEnc = note === '' || dek === null ? null : encrypt(dek, note, { userId, purpose: NOTE_PURPOSE });
  const tagIds = await resolveTagsIn(tx, userId, draft.tags ?? []);
  const common = {
    occurredAt: draft.occurredAt,
    localDate,
    description: draft.description?.trim() || null,
    merchant: draft.merchant?.trim() || null,
    noteEnc,
    source: draft.source ?? 'manual',
  };

  try {
    if (draft.type !== 'transfer') {
      const account = (await accountsIn(tx, [draft.accountId])).get(draft.accountId) as AccountRow;
      if (draft.categoryId !== null) await checkCategoryIn(tx, draft.categoryId, draft.type);
      const valuation = await valuationIn(tx, context.baseCurrency, [account.currency], localDate);
      const build = draft.type === 'expense' ? expensePostings : incomePostings;
      return {
        header: { ...common, type: draft.type, categoryId: draft.categoryId },
        postings: build({ ...valuation, account, amountMinor: draft.amountMinor }),
        transferMeta: null,
        tagIds,
        fxDifference: null,
      };
    }

    if (draft.fromAccountId === draft.toAccountId) throw new SameAccountTransferError();
    const byId = await accountsIn(tx, [draft.fromAccountId, draft.toAccountId]);
    const from = byId.get(draft.fromAccountId) as AccountRow;
    const to = byId.get(draft.toAccountId) as AccountRow;
    if (draft.fee) await checkCategoryIn(tx, draft.fee.categoryId, 'fee');
    let reference: FxRate | undefined;
    let rateSource: { rateSource: string; rateAsOf: LocalDate | null } | null = null;
    if (from.currency !== to.currency) {
      if (draft.manualRate) {
        reference = draft.manualRate;
        rateSource = { rateSource: 'manual', rateAsOf: localDate };
      } else {
        const resolved =
          (await referenceRateIn(tx, to.currency, from.currency, localDate)) ??
          (await referenceRateIn(tx, to.currency, from.currency));
        if (resolved === null) throw new MissingRateError(from.currency, to.currency);
        reference = resolved;
        rateSource = { rateSource: resolved.provider, rateAsOf: resolved.asOf };
      }
    }
    // When the reference connects to the base currency (one leg is in it), it values both legs; otherwise each
    // non-base leg needs its own rate to the base currency.
    const referenceValuesLegs =
      reference !== undefined && [reference.base, reference.quote].includes(context.baseCurrency);
    const valuation = await valuationIn(
      tx,
      context.baseCurrency,
      referenceValuesLegs ? [] : [from.currency, to.currency],
      localDate,
    );
    const { postings: lines, fxDifference } = transferPostings({
      ...valuation,
      from,
      to,
      sentMinor: draft.sentMinor,
      receivedMinor: draft.receivedMinor,
      ...(reference === undefined ? {} : { reference }),
      ...(draft.fee ? { fee: draft.fee } : {}),
      fxDifferenceCategoryId:
        from.currency === to.currency ? '' : await builtInCategoryIn(tx, userId, FX_DIFFERENCE_CATEGORY),
    });
    return {
      header: { ...common, type: 'transfer', categoryId: null },
      postings: lines,
      transferMeta: {
        sentMinor: draft.sentMinor,
        sentCurrency: from.currency,
        receivedMinor: draft.receivedMinor,
        receivedCurrency: to.currency,
        referenceRate: reference?.rate ?? null,
        rateBase: reference?.base ?? null,
        rateQuote: reference?.quote ?? null,
        rateSource: rateSource?.rateSource ?? null,
        rateAsOf: rateSource?.rateAsOf ?? null,
        fxDiffBaseMinor: fxDifference?.differenceBaseMinor ?? 0n,
      },
      tagIds,
      fxDifference,
    };
  } catch (error) {
    throw domainError(error);
  }
}

/** Writes a plan's postings, transfer details, and tags for `transactionId` (replacing existing ones). */
export async function writeLinesIn(
  tx: Transaction,
  userId: string,
  transactionId: string,
  plan: TransactionPlan,
): Promise<void> {
  await tx.delete(postings).where(eq(postings.transactionId, transactionId));
  await tx.delete(transferMeta).where(eq(transferMeta.transactionId, transactionId));
  await tx.insert(postings).values(plan.postings.map((line) => ({ ...line, userId, transactionId })));
  if (plan.transferMeta !== null) await tx.insert(transferMeta).values({ ...plan.transferMeta, userId, transactionId });
  await setTransactionTagsIn(tx, userId, transactionId, plan.tagIds);
}

export interface RecordResult {
  readonly id: string;
  /** `false` when `clientId` was already used: the earlier transaction is returned unchanged. */
  readonly created: boolean;
  readonly fxDifference: FxDifference | null;
}

/**
 * Records a confirmed transaction (the user saved the form) in one go: header, postings, transfer details, tags,
 * and an activity entry. Idempotent per `clientId`: a replay (also a concurrent one) returns the first transaction.
 */
export async function recordTransactionIn(
  tx: Transaction,
  userId: string,
  draft: TransactionDraft,
  dek: Dek | null,
  now: Date,
): Promise<RecordResult> {
  const plan = await planTransactionIn(tx, userId, draft, dek);
  const [row] = await tx
    .insert(transactions)
    .values({
      ...plan.header,
      userId,
      clientId: draft.clientId,
      splitParentId: draft.splitParentId ?? null,
      duplicatedFromId: draft.duplicatedFromId ?? null,
      confirmedByUserAt: now,
    })
    .onConflictDoNothing({ target: [transactions.userId, transactions.clientId] })
    .returning({ id: transactions.id });
  if (row === undefined) {
    const first = firstRow(
      await tx.select({ id: transactions.id }).from(transactions).where(eq(transactions.clientId, draft.clientId)),
      'transactions',
    );
    return { id: first.id, created: false, fxDifference: null };
  }
  await writeLinesIn(tx, userId, row.id, plan);
  await logActivity(tx, userId, 'transaction', [row.id], 'created', { source: plan.header.source });
  return { id: row.id, created: true, fxDifference: plan.fxDifference };
}
