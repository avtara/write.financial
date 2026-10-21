// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Receivables (FR-U7, FR-L5 split bills): money other people owe the user. Lending is a `receivable_out`
 * transaction (one −amount principal posting on the account the money left; not an expense), a repayment a
 * `receivable_in` transaction (+amount into the account it came into; not income), and "Hapuskan" a `writeoff`
 * expense in the chosen category whose principal posting moves no money (amount 0) but carries the remaining value in
 * the base currency as Out. A receivable recorded with `recordTransaction: false` (lent before the ledger started,
 * already in the balance) and payments recorded that way have no transaction.
 *
 * The person and the note are personal data, encrypted with the user's DEK. With a reminder (FR-U7 "Ingatkan aku
 * H-1"), one `scheduled_occurrences` row (`receivable`) is kept in sync: due on the due date, expecting the remaining
 * amount, reminding at the user's reminder time (default 09.00) the day before; it never enters the Review queue and
 * is deleted once the receivable is settled, written off, or removed. Every method is one user transaction.
 */
import { decryptText, encrypt } from '@wf/crypto/cipher';
import type { Dek } from '@wf/crypto/envelope';
import { BAD_DEBT_CATEGORY } from '@wf/domain/categories';
import type { LocalDate } from '@wf/domain/period';
import type { ReceivableSource, ReceivableStatus } from '@wf/domain/receivables';
import { reminderAt } from '@wf/domain/recurrence';
import { expensePostings, incomePostings, toBase, type PostingDraft } from '@wf/domain/transactions';
import { and, asc, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { firstRow, withUser, type Database, type Transaction } from './db.ts';
import { logActivity } from './activity.ts';
import {
  accountsIn,
  assertOpenDatesIn,
  assertOpenTransactionsIn,
  builtInCategoryIn,
  checkCategoryIn,
  localDateOf,
  NOTE_PURPOSE,
  userContextIn,
  valuationIn,
  type LedgerAccount,
} from './ledger-core.ts';
import { LedgerError } from './ledger-errors.ts';
import { notificationSettingsIn } from './notification-settings.ts';
import {
  attachments,
  postings,
  receivablePayments,
  receivables,
  scheduledOccurrences,
  transactions,
} from './schema.ts';

/** AAD purpose of `receivables.counterparty_enc`. */
export const COUNTERPARTY_PURPOSE = 'receivables.counterparty';
/** AAD purpose of `receivables.note_enc`. */
export const RECEIVABLE_NOTE_PURPOSE = 'receivables.note';
/** Longest name of the person who owes the money (characters, trimmed). */
export const MAX_COUNTERPARTY_LENGTH = 60;

/** "Catat piutang". */
export interface ReceivableInput {
  /** Idempotency key of the form submission; also the receivable's id and its lending transaction's client id. */
  readonly clientId: string;
  /** Who owes it; trimmed, 1–60 characters; stored encrypted. */
  readonly counterparty: string;
  /** Positive, in the currency of `fromAccountId`. */
  readonly amountMinor: bigint;
  /** The active account the money left. */
  readonly fromAccountId: string;
  readonly source: ReceivableSource;
  /** `split_bill` only: the user's own part of the split bill (a live expense). */
  readonly sourceTransactionId?: string | null;
  /** What it was for; also the description of its transactions. */
  readonly description?: string | null;
  /** Stored encrypted, on the receivable and its lending transaction. */
  readonly note?: string | null;
  readonly lentAt: Date;
  /** On or after the lent date (user's time zone); `null` = no deadline. */
  readonly dueDate: LocalDate | null;
  /** H-1 reminder to the user only; needs `dueDate`. */
  readonly remind: boolean;
  /** Default `true`; `false` = lent before the ledger started (already in the balance): no transaction. */
  readonly recordTransaction?: boolean;
}

export interface ReceivablePaymentView {
  readonly id: string;
  /** Positive, in the receivable's currency. */
  readonly amountMinor: bigint;
  /** The account it came into. */
  readonly accountId: string;
  readonly receivedOn: LocalDate;
  /** The `receivable_in` transaction; `null` when recorded without one. */
  readonly transactionId: string | null;
}

export interface ReceivableView {
  readonly id: string;
  /** Decrypted. */
  readonly counterparty: string;
  readonly description: string | null;
  /** Decrypted. */
  readonly note: string | null;
  /** Amounts in `currency`. */
  readonly principalMinor: bigint;
  readonly paidMinor: bigint;
  readonly remainingMinor: bigint;
  /** paid / principal in basis points, rounded down (7500 = 75%). */
  readonly repaidBps: number;
  readonly currency: string;
  readonly fromAccountId: string;
  readonly source: ReceivableSource;
  readonly sourceTransactionId: string | null;
  /** The `receivable_out` transaction; `null` when recorded without one. */
  readonly transactionId: string | null;
  readonly lentOn: LocalDate;
  readonly dueDate: LocalDate | null;
  readonly remind: boolean;
  readonly status: ReceivableStatus;
  /** When the settling payment was received. */
  readonly settledAt: Date | null;
  /** When it was written off ("Hapuskan"). */
  readonly writtenOffAt: Date | null;
  readonly writeoffTransactionId: string | null;
  /** Oldest first. */
  readonly payments: ReceivablePaymentView[];
}

/** The Receivables tab. */
export interface ReceivablesOverview {
  /** The user's calendar date (countdowns to due dates). */
  readonly today: LocalDate;
  /** Open and partially paid, by due date (no deadline last), then lent date. */
  readonly active: ReceivableView[];
  /** Settled or written off within the history window, newest first. */
  readonly history: ReceivableView[];
  /** Σ remaining of `active`, in the base currency. */
  readonly outstandingMinor: bigint;
  /** Distinct counterparties, most recently lent to first ("pernah: …" suggestions). */
  readonly people: string[];
}

/** "Terima pembayaran". */
export interface ReceivablePaymentInput {
  /** Idempotency key of the form submission; also the payment's id and its transaction's client id. */
  readonly clientId: string;
  /** Positive, at most the remaining amount, in the receivable's currency. */
  readonly amountMinor: bigint;
  /** The active account it came into, in the receivable's currency. */
  readonly accountId: string;
  /** On or after the lent date; the settling payment's is `settledAt`. */
  readonly receivedAt: Date;
  /** Default `true`; `false` = received before the ledger started (already in the balance): no transaction. */
  readonly recordTransaction?: boolean;
}

/** "Hapuskan". */
export interface ReceivableWriteOffInput {
  /** Idempotency key: the write-off transaction's client id. */
  readonly clientId: string;
  /** On or after the lent date; becomes `writtenOffAt`. */
  readonly occurredAt: Date;
  /** An active expense or fee category; default the built-in "Piutang tak tertagih" (`system:bad_debt`). */
  readonly categoryId?: string;
}

/** Fields of {@link ReceivableInput} that can change later; omitted = unchanged. */
export interface ReceivablePatch {
  readonly counterparty?: string;
  readonly description?: string | null;
  readonly note?: string | null;
  readonly dueDate?: LocalDate | null;
  readonly remind?: boolean;
}

export interface ReceivablesRepository {
  /** The Receivables tab; `historyDays` (default 90) bounds the history by `settledAt`/`writtenOffAt`. */
  list: (userId: string, options?: { readonly historyDays?: number }) => Promise<ReceivablesOverview>;
  /** @throws {LedgerError} `NOT_FOUND` */
  get: (userId: string, id: string) => Promise<ReceivableView>;
  /**
   * Records a receivable and, unless `recordTransaction` is `false`, its `receivable_out` transaction. Idempotent per
   * `clientId`: a replay returns the first receivable.
   * @throws {LedgerError} `INVALID_RECEIVABLE`, `NOT_FOUND`, `ACCOUNT_ARCHIVED`, `PERIOD_CLOSED`, `FX_RATE_MISSING`
   */
  record: (
    userId: string,
    input: ReceivableInput,
  ) => Promise<{ readonly receivable: ReceivableView; readonly transactionId: string | null }>;
  /**
   * Records a repayment (and its `receivable_in` transaction): `open` → `partial` → `settled`. Idempotent per
   * `clientId`.
   * @throws {LedgerError} `INVALID_RECEIVABLE` (beyond the remaining amount, another currency, before the lent date,
   * settled or written off), `NOT_FOUND`, `ACCOUNT_ARCHIVED`, `PERIOD_CLOSED`, `FX_RATE_MISSING`
   */
  receivePayment: (userId: string, id: string, input: ReceivablePaymentInput) => Promise<ReceivableView>;
  /**
   * "Hapuskan": the remaining amount becomes a `writeoff` expense in `categoryId` (default "Piutang tak tertagih",
   * created on first use); balances do not change.
   * Idempotent per `clientId`.
   * @throws {LedgerError} `INVALID_RECEIVABLE` (settled or written off, before the lent date), `NOT_FOUND`,
   * `INVALID_CATEGORY`, `CATEGORY_KIND_MISMATCH`, `PERIOD_CLOSED`, `FX_RATE_MISSING`
   */
  writeOff: (userId: string, id: string, input: ReceivableWriteOffInput) => Promise<ReceivableView>;
  /**
   * Changes the person, description, note, due date, or reminder; a new description or note is carried to its
   * transactions.
   * @throws {LedgerError} `INVALID_RECEIVABLE`, `NOT_FOUND`, `PERIOD_CLOSED` (a changed description or note of
   * transactions in a closed period)
   */
  update: (userId: string, id: string, patch: ReceivablePatch) => Promise<ReceivableView>;
  /**
   * Deletes the receivable, its payments, its transactions (hard), and its reminder. Returns the attachment object
   * keys of those transactions for the caller to delete from storage.
   * @throws {LedgerError} `NOT_FOUND`, `PERIOD_CLOSED`
   */
  remove: (userId: string, id: string) => Promise<{ readonly objectKeys: string[] }>;
}

type ReceivableRow = typeof receivables.$inferSelect;

/** The columns a {@link ReceivableView} is made of. */
const VIEW = {
  id: receivables.id,
  counterpartyEnc: receivables.counterpartyEnc,
  description: receivables.description,
  noteEnc: receivables.noteEnc,
  principalMinor: receivables.principalMinor,
  currency: receivables.currency,
  fromAccountId: receivables.fromAccountId,
  source: receivables.source,
  sourceTransactionId: receivables.sourceTransactionId,
  transactionId: receivables.transactionId,
  lentOn: receivables.lentOn,
  dueDate: receivables.dueDate,
  remind: receivables.remind,
  status: receivables.status,
  settledAt: receivables.settledAt,
  writtenOffAt: receivables.writtenOffAt,
  writeoffTransactionId: receivables.writeoffTransactionId,
};

/** A transaction a receivable writes. */
interface ReceivableEntry {
  readonly type: 'receivable_out' | 'receivable_in' | 'writeoff';
  readonly clientId: string;
  readonly occurredAt: Date;
  readonly localDate: LocalDate;
  readonly description: string | null;
  readonly noteEnc: Uint8Array | null;
  readonly categoryId: string | null;
  readonly receivableId: string;
  readonly postings: readonly PostingDraft[];
}

const ACTIVE: ReceivableStatus[] = ['open', 'partial'];

const invalid = (message: string) => new LedgerError('INVALID_RECEIVABLE', message);

/** Trimmed text, `null` when empty. */
const clean = (text: string | null | undefined) => text?.trim() || null;

function checkCounterparty(counterparty: string): string {
  const name = counterparty.trim();
  if (name.length === 0 || name.length > MAX_COUNTERPARTY_LENGTH) {
    throw invalid(`The person must have 1–${MAX_COUNTERPARTY_LENGTH} characters`);
  }
  return name;
}

function checkSchedule(lentOn: LocalDate, dueDate: LocalDate | null, remind: boolean): void {
  if (dueDate !== null && dueDate < lentOn) throw invalid('The due date is before the lent date');
  if (remind && dueDate === null) throw invalid('A reminder needs a due date');
}

/** Writes a receivable transaction: header, postings, and an activity entry. */
async function insertEntryIn(tx: Transaction, userId: string, entry: ReceivableEntry, now: Date): Promise<string> {
  const { postings: lines, ...header } = entry;
  const row = firstRow(
    await tx
      .insert(transactions)
      .values({ ...header, userId, confirmedByUserAt: now })
      .returning({ id: transactions.id }),
    'transactions',
  );
  await tx.insert(postings).values(lines.map((line) => ({ ...line, userId, transactionId: row.id })));
  await logActivity(tx, userId, 'transaction', [row.id], 'created', { source: 'manual' });
  return row.id;
}

async function lockedIn(tx: Transaction, id: string): Promise<ReceivableRow> {
  const [row] = await tx.select().from(receivables).where(eq(receivables.id, id)).for('update');
  if (row === undefined) throw new LedgerError('NOT_FOUND', 'No such receivable');
  return row;
}

async function paymentsIn(tx: Transaction, ids: readonly string[]) {
  return tx
    .select({
      id: receivablePayments.id,
      receivableId: receivablePayments.receivableId,
      amountMinor: receivablePayments.amountMinor,
      accountId: receivablePayments.accountId,
      receivedOn: receivablePayments.receivedOn,
      transactionId: receivablePayments.transactionId,
    })
    .from(receivablePayments)
    .where(inArray(receivablePayments.receivableId, [...ids]))
    .orderBy(asc(receivablePayments.receivedOn), asc(receivablePayments.createdAt), asc(receivablePayments.id));
}

async function remainingIn(tx: Transaction, row: ReceivableRow): Promise<bigint> {
  const payments = await paymentsIn(tx, [row.id]);
  return payments.reduce((remaining, payment) => remaining - payment.amountMinor, row.principalMinor);
}

/**
 * Keeps the receivable's reminder occurrence in sync: with a reminder on an open or partially paid receivable, one
 * row on its due date expecting the remaining amount, reminding at the user's reminder time the day before (none when
 * that has passed); otherwise none.
 */
async function syncReminderIn(tx: Transaction, userId: string, id: string, now: Date): Promise<void> {
  const row = firstRow(await tx.select().from(receivables).where(eq(receivables.id, id)), 'receivables');
  const dueDate = row.remind && ACTIVE.includes(row.status) ? row.dueDate : null;
  await tx
    .delete(scheduledOccurrences)
    .where(
      and(
        eq(scheduledOccurrences.sourceType, 'receivable'),
        eq(scheduledOccurrences.sourceId, id),
        dueDate === null ? undefined : ne(scheduledOccurrences.dueDate, dueDate),
      ),
    );
  if (dueDate === null) return;
  const { timezone } = await userContextIn(tx, userId);
  const { reminderTime } = await notificationSettingsIn(tx, userId);
  const remindAt = reminderAt(dueDate, 1, timezone, reminderTime);
  const expectedMinor = await remainingIn(tx, row);
  await tx
    .insert(scheduledOccurrences)
    .values({
      userId,
      sourceType: 'receivable',
      sourceId: id,
      dueDate,
      expectedMinor,
      currency: row.currency,
      remindAt: remindAt > now ? remindAt : null,
    })
    .onConflictDoUpdate({
      target: [scheduledOccurrences.sourceType, scheduledOccurrences.sourceId, scheduledOccurrences.dueDate],
      set: { expectedMinor, updatedAt: now },
    });
}

export function createReceivables(
  db: Database,
  { getDek, now = () => new Date() }: { getDek: (userId: string) => Promise<Dek>; now?: () => Date },
): ReceivablesRepository {
  /** The receivables matching `where` in `order`, decrypted, with their payments. */
  async function viewsIn(
    tx: Transaction,
    userId: string,
    dek: Dek,
    where: SQL | undefined,
    order: SQL[],
  ): Promise<ReceivableView[]> {
    const rows = await tx
      .select(VIEW)
      .from(receivables)
      .where(where)
      .orderBy(...order);
    const paymentsOf = new Map<string, ReceivablePaymentView[]>();
    const ids = rows.map((row) => row.id);
    for (const { receivableId, ...payment } of await paymentsIn(tx, ids)) {
      paymentsOf.set(receivableId, [...(paymentsOf.get(receivableId) ?? []), payment]);
    }
    const open = (blob: Uint8Array, purpose: string) => decryptText(dek, blob, { userId, purpose });
    return rows.map(({ counterpartyEnc, noteEnc, ...row }) => {
      const payments = paymentsOf.get(row.id) ?? [];
      const paidMinor = payments.reduce((sum, payment) => sum + payment.amountMinor, 0n);
      return {
        ...row,
        counterparty: open(counterpartyEnc, COUNTERPARTY_PURPOSE),
        note: noteEnc === null ? null : open(noteEnc, RECEIVABLE_NOTE_PURPOSE),
        paidMinor,
        remainingMinor: row.principalMinor - paidMinor,
        repaidBps: Number((paidMinor * 10_000n) / row.principalMinor),
        payments,
      };
    });
  }

  const viewIn = async (tx: Transaction, userId: string, dek: Dek, id: string) =>
    firstRow(await viewsIn(tx, userId, dek, eq(receivables.id, id), []), 'receivables');

  return {
    list: async (userId, { historyDays = 90 } = {}) => {
      const dek = await getDek(userId);
      return withUser(db, userId, async (tx) => {
        const at = now();
        const { baseCurrency, timezone } = await userContextIn(tx, userId);
        const today = localDateOf(at, timezone);
        const since = new Date(at.getTime() - historyDays * 86_400_000).toISOString();
        const active = await viewsIn(tx, userId, dek, inArray(receivables.status, ACTIVE), [
          sql`${receivables.dueDate} asc nulls last`,
          asc(receivables.lentOn),
          asc(receivables.id),
        ]);
        const closedAt = sql`coalesce(${receivables.settledAt}, ${receivables.writtenOffAt})`;
        const history = await viewsIn(
          tx,
          userId,
          dek,
          and(inArray(receivables.status, ['settled', 'written_off']), sql`${closedAt} >= ${since}::timestamptz`),
          [desc(closedAt), desc(receivables.id)],
        );
        const valuation = await valuationIn(
          tx,
          baseCurrency,
          active.map((row) => row.currency),
          today,
        );
        const outstandingMinor = active.reduce(
          (sum, row) => sum + toBase({ minor: row.remainingMinor, currency: row.currency }, valuation),
          0n,
        );
        const names = await tx
          .select({ counterpartyEnc: receivables.counterpartyEnc })
          .from(receivables)
          .orderBy(desc(receivables.lentOn), desc(receivables.createdAt), desc(receivables.id));
        const people = [
          ...new Set(
            names.map((row) => decryptText(dek, row.counterpartyEnc, { userId, purpose: COUNTERPARTY_PURPOSE })),
          ),
        ];
        return { today, active, history, outstandingMinor, people };
      });
    },

    get: async (userId, id) => {
      const dek = await getDek(userId);
      return withUser(db, userId, async (tx) => {
        const [view] = await viewsIn(tx, userId, dek, eq(receivables.id, id), []);
        if (view === undefined) throw new LedgerError('NOT_FOUND', 'No such receivable');
        return view;
      });
    },

    record: async (userId, input) => {
      const dek = await getDek(userId);
      return withUser(db, userId, async (tx) => {
        const counterparty = checkCounterparty(input.counterparty);
        if (input.amountMinor <= 0n) throw invalid('The amount must be greater than zero');
        const { baseCurrency, timezone } = await userContextIn(tx, userId);
        const lentOn = localDateOf(input.lentAt, timezone);
        checkSchedule(lentOn, input.dueDate, input.remind);
        const account = (await accountsIn(tx, [input.fromAccountId])).get(input.fromAccountId) as LedgerAccount;
        const sourceTransactionId = input.sourceTransactionId ?? null;
        if (sourceTransactionId !== null) {
          if (input.source !== 'split_bill') throw invalid('Only a split bill has a source transaction');
          const [source] = await tx
            .select({ type: transactions.type, deletedAt: transactions.deletedAt })
            .from(transactions)
            .where(eq(transactions.id, sourceTransactionId));
          if (source === undefined || source.deletedAt !== null) {
            throw new LedgerError('NOT_FOUND', 'No such transaction');
          }
          if (source.type !== 'expense') throw invalid('The split bill part must be an expense');
        }
        const recordTransaction = input.recordTransaction ?? true;
        if (recordTransaction) await assertOpenDatesIn(tx, [lentOn]);
        const description = clean(input.description);
        const note = clean(input.note);
        const at = now();
        const [created] = await tx
          .insert(receivables)
          .values({
            id: input.clientId,
            userId,
            counterpartyEnc: encrypt(dek, counterparty, { userId, purpose: COUNTERPARTY_PURPOSE }),
            description,
            noteEnc: note === null ? null : encrypt(dek, note, { userId, purpose: RECEIVABLE_NOTE_PURPOSE }),
            principalMinor: input.amountMinor,
            currency: account.currency,
            fromAccountId: account.id,
            source: input.source,
            sourceTransactionId,
            lentOn,
            dueDate: input.dueDate,
            remind: input.remind,
          })
          .onConflictDoNothing()
          .returning({ id: receivables.id });
        if (created === undefined) {
          const first = await viewIn(tx, userId, dek, input.clientId);
          return { receivable: first, transactionId: first.transactionId };
        }
        let transactionId: string | null = null;
        if (recordTransaction) {
          const valuation = await valuationIn(tx, baseCurrency, [account.currency], lentOn);
          transactionId = await insertEntryIn(
            tx,
            userId,
            {
              type: 'receivable_out',
              clientId: input.clientId,
              occurredAt: input.lentAt,
              localDate: lentOn,
              description,
              noteEnc: note === null ? null : encrypt(dek, note, { userId, purpose: NOTE_PURPOSE }),
              categoryId: null,
              receivableId: input.clientId,
              postings: expensePostings({ ...valuation, account, amountMinor: input.amountMinor }),
            },
            at,
          );
          await tx.update(receivables).set({ transactionId }).where(eq(receivables.id, input.clientId));
        }
        await syncReminderIn(tx, userId, input.clientId, at);
        return { receivable: await viewIn(tx, userId, dek, input.clientId), transactionId };
      });
    },

    receivePayment: async (userId, id, input) => {
      const dek = await getDek(userId);
      return withUser(db, userId, async (tx) => {
        // The row lock serializes payments of one receivable, so a replay sees the first one.
        const row = await lockedIn(tx, id);
        const [replay] = await tx
          .select({ id: receivablePayments.id })
          .from(receivablePayments)
          .where(eq(receivablePayments.id, input.clientId));
        if (replay !== undefined) return viewIn(tx, userId, dek, id);
        if (!ACTIVE.includes(row.status)) throw invalid(`The receivable is ${row.status}`);
        const remaining = await remainingIn(tx, row);
        if (input.amountMinor <= 0n || input.amountMinor > remaining) {
          throw invalid('The payment must be positive and at most the remaining amount');
        }
        const account = (await accountsIn(tx, [input.accountId])).get(input.accountId) as LedgerAccount;
        if (account.currency !== row.currency) throw invalid('The account has another currency');
        const { baseCurrency, timezone } = await userContextIn(tx, userId);
        const receivedOn = localDateOf(input.receivedAt, timezone);
        if (receivedOn < row.lentOn) throw invalid('The payment is before the lent date');
        const at = now();
        let transactionId: string | null = null;
        if (input.recordTransaction ?? true) {
          await assertOpenDatesIn(tx, [receivedOn]);
          const valuation = await valuationIn(tx, baseCurrency, [account.currency], receivedOn);
          transactionId = await insertEntryIn(
            tx,
            userId,
            {
              type: 'receivable_in',
              clientId: input.clientId,
              occurredAt: input.receivedAt,
              localDate: receivedOn,
              description: row.description,
              noteEnc: null,
              categoryId: null,
              receivableId: id,
              postings: incomePostings({ ...valuation, account, amountMinor: input.amountMinor }),
            },
            at,
          );
        }
        await tx.insert(receivablePayments).values({
          id: input.clientId,
          userId,
          receivableId: id,
          accountId: account.id,
          amountMinor: input.amountMinor,
          receivedOn,
          transactionId,
        });
        const settled = input.amountMinor === remaining;
        await tx
          .update(receivables)
          .set({
            status: settled ? 'settled' : 'partial',
            settledAt: settled ? input.receivedAt : null,
            updatedAt: at,
          })
          .where(eq(receivables.id, id));
        await syncReminderIn(tx, userId, id, at);
        return viewIn(tx, userId, dek, id);
      });
    },

    writeOff: async (userId, id, input) => {
      const dek = await getDek(userId);
      return withUser(db, userId, async (tx) => {
        const row = await lockedIn(tx, id);
        if (row.writeoffTransactionId !== null) {
          const first = firstRow(
            await tx
              .select({ clientId: transactions.clientId })
              .from(transactions)
              .where(eq(transactions.id, row.writeoffTransactionId)),
            'transactions',
          );
          if (first.clientId === input.clientId) return viewIn(tx, userId, dek, id);
        }
        if (!ACTIVE.includes(row.status)) throw invalid(`The receivable is ${row.status}`);
        const categoryId = input.categoryId ?? (await builtInCategoryIn(tx, userId, BAD_DEBT_CATEGORY));
        await checkCategoryIn(tx, categoryId, 'expense');
        const { baseCurrency, timezone } = await userContextIn(tx, userId);
        const localDate = localDateOf(input.occurredAt, timezone);
        if (localDate < row.lentOn) throw invalid('The write-off is before the lent date');
        await assertOpenDatesIn(tx, [localDate]);
        const valuation = await valuationIn(tx, baseCurrency, [row.currency], localDate);
        const account = { id: row.fromAccountId, currency: row.currency };
        // The remaining amount valued like an expense of it, but moving no money.
        const lines = expensePostings({ ...valuation, account, amountMinor: await remainingIn(tx, row) }).map(
          (line) => ({ ...line, amountMinor: 0n }),
        );
        const at = now();
        const writeoffTransactionId = await insertEntryIn(
          tx,
          userId,
          {
            type: 'writeoff',
            clientId: input.clientId,
            occurredAt: input.occurredAt,
            localDate,
            description: row.description,
            noteEnc: null,
            categoryId,
            receivableId: id,
            postings: lines,
          },
          at,
        );
        await tx
          .update(receivables)
          .set({ status: 'written_off', writtenOffAt: input.occurredAt, writeoffTransactionId, updatedAt: at })
          .where(eq(receivables.id, id));
        await syncReminderIn(tx, userId, id, at);
        return viewIn(tx, userId, dek, id);
      });
    },

    update: async (userId, id, patch) => {
      const dek = await getDek(userId);
      return withUser(db, userId, async (tx) => {
        const row = await lockedIn(tx, id);
        const at = now();
        const dueDate = patch.dueDate === undefined ? row.dueDate : patch.dueDate;
        const remind = patch.remind ?? row.remind;
        checkSchedule(row.lentOn, dueDate, remind);
        const counterpartyEnc =
          patch.counterparty === undefined
            ? row.counterpartyEnc
            : encrypt(dek, checkCounterparty(patch.counterparty), { userId, purpose: COUNTERPARTY_PURPOSE });
        const description = patch.description === undefined ? row.description : clean(patch.description);
        const before =
          row.noteEnc === null ? null : decryptText(dek, row.noteEnc, { userId, purpose: RECEIVABLE_NOTE_PURPOSE });
        const note = patch.note === undefined ? before : clean(patch.note);
        const seal = (purpose: string) => (note === null ? null : encrypt(dek, note, { userId, purpose }));

        // A new description or note is carried to the transactions, so it follows their period's lock.
        const fields = [
          ...(description === row.description ? [] : ['description']),
          ...(note === before ? [] : ['note']),
        ];
        if (fields.length > 0) {
          const linked = await tx
            .select({ id: transactions.id })
            .from(transactions)
            .where(eq(transactions.receivableId, id));
          const ids = linked.map((line) => line.id);
          await assertOpenTransactionsIn(tx, ids);
          await tx.update(transactions).set({ description, updatedAt: at }).where(eq(transactions.receivableId, id));
          // The note lives on the lending transaction only.
          await tx
            .update(transactions)
            .set({ noteEnc: seal(NOTE_PURPOSE) })
            .where(and(eq(transactions.receivableId, id), eq(transactions.type, 'receivable_out')));
          await logActivity(tx, userId, 'transaction', ids, 'updated', { fields });
        }
        await tx
          .update(receivables)
          .set({
            counterpartyEnc,
            description,
            noteEnc: seal(RECEIVABLE_NOTE_PURPOSE),
            dueDate,
            remind,
            updatedAt: at,
          })
          .where(eq(receivables.id, id));
        await syncReminderIn(tx, userId, id, at);
        return viewIn(tx, userId, dek, id);
      });
    },

    remove: (userId, id) =>
      withUser(db, userId, async (tx) => {
        await lockedIn(tx, id);
        const linked = await tx
          .select({ id: transactions.id })
          .from(transactions)
          .where(eq(transactions.receivableId, id));
        const ids = linked.map((row) => row.id);
        await assertOpenTransactionsIn(tx, ids);
        const files = await tx
          .select({ objectKey: attachments.objectKey, thumbnailKey: attachments.thumbnailKey })
          .from(attachments)
          .where(inArray(attachments.transactionId, ids));
        await tx
          .delete(scheduledOccurrences)
          .where(and(eq(scheduledOccurrences.sourceType, 'receivable'), eq(scheduledOccurrences.sourceId, id)));
        // One statement: the lending transaction cascades to the receivable (and its payments) while every other
        // transaction pointing at it goes too.
        await tx.delete(transactions).where(eq(transactions.receivableId, id));
        await tx.delete(receivables).where(eq(receivables.id, id));
        const objectKeys = files.flatMap((file) =>
          file.thumbnailKey === null ? [file.objectKey] : [file.objectKey, file.thumbnailKey],
        );
        return { objectKeys: [...new Set(objectKeys)] };
      }),
  };
}
