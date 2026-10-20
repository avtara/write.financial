// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The model behind the Record Transaction form (FR-T2–T4, T8): its values, defaults, validation, the impact preview
 * (balances after saving), the figures of a cross-currency transfer, the server input it becomes, and the JSON a
 * draft keeps (FR-T9). Pure: no React, no messages.
 */
import type { AccountView } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import type { JsonObject } from '@wf/db/schema';
import type { TransactionDetail } from '@wf/db/transactions';
import {
  convert,
  effectiveRate,
  fxDifference,
  manualRateDeviationBps,
  parseRate,
  type FxDifference,
  type FxRate,
} from '@wf/domain/fx';
import { currencyInfo, type Locale } from '@wf/domain/money';
import { addDays, parseLocalDate, type LocalDate } from '@wf/domain/period';
import { toLocalDate } from '@wf/ui/dates';
import type { RecordTransactionInput } from '../../server/fn/transactions-write.ts';

export type EntryKind = 'expense' | 'income' | 'transfer';
export type RateMode = 'reference' | 'manual';

export interface TransactionFormValues {
  readonly type: EntryKind;
  /** The expense or income amount, or what a transfer sends, in the (source) account's currency. */
  readonly amountMinor: bigint | null;
  /** Expense or income category. */
  readonly categoryId: string | null;
  /** The expense or income account, or the source of a transfer. */
  readonly accountId: string | null;
  /** The destination of a transfer. */
  readonly toAccountId: string | null;
  /** What arrived ("Diterima") in a cross-currency transfer; `null` until typed, which means the expected amount. */
  readonly receivedMinor: bigint | null;
  readonly rateMode: RateMode;
  /** The manual rate as typed, in the reference rate's orientation (`16.474` for 1 USD = Rp16.474). */
  readonly manualRate: string;
  /** Transfer fee from the source account (FR-T4), recorded as an expense in {@link feeCategoryId}. */
  readonly feeMinor: bigint | null;
  readonly feeCategoryId: string | null;
  readonly date: LocalDate;
  /** `HH:mm`, in the user's time zone. */
  readonly time: string;
  /** "Catatan": what the transaction was, shown in every list. */
  readonly description: string;
  /** Private note, stored encrypted. */
  readonly note: string;
  /** Tag slugs, at most five. */
  readonly tags: readonly string[];
}

/** The accounts a new transaction may use: archived ones are hidden (FR-R5). */
export function activeAccounts(accounts: readonly AccountView[]): AccountView[] {
  return accounts.filter((account) => account.status === 'active');
}

/** The default quick-entry account (FR-R2), else the first active one. */
export function defaultAccountId(accounts: readonly AccountView[]): string | null {
  const active = activeAccounts(accounts);
  return (active.find((account) => account.isDefaultQuickEntry) ?? active[0])?.id ?? null;
}

export function emptyValues(start: {
  readonly type?: EntryKind;
  readonly accountId: string | null;
  readonly date: LocalDate;
  readonly time: string;
}): TransactionFormValues {
  return {
    type: start.type ?? 'expense',
    amountMinor: null,
    categoryId: null,
    accountId: start.accountId,
    toAccountId: null,
    receivedMinor: null,
    rateMode: 'reference',
    manualRate: '',
    feeMinor: null,
    feeCategoryId: null,
    date: start.date,
    time: start.time,
    description: '',
    note: '',
    tags: [],
  };
}

/**
 * The form values of a recorded transaction (FR-L4 edit, FR-L6 duplicate): accounts and amounts from its postings
 * (a transfer's fee and its manual rate, typed back in `locale`'s decimal format), date and time on the wall clock
 * of `timeZone`. `at` replaces the date and time (a duplicate is dated now).
 */
export function valuesFromDetail(
  detail: TransactionDetail,
  context: { readonly timeZone: string; readonly locale: Locale; readonly at?: Date },
): TransactionFormValues {
  const instant = context.at ?? detail.occurredAt;
  const principal = detail.postings.filter((posting) => posting.role === 'principal');
  const fee = detail.postings.find((posting) => posting.role === 'fee');
  const from = principal.find((posting) => posting.amountMinor < 0n) ?? principal[0];
  const to = principal.find((posting) => posting.amountMinor > 0n && posting !== from);
  const transfer = detail.type === 'transfer' ? detail.transfer : null;
  const manual = transfer?.rateSource === 'manual' && transfer.referenceRate !== null ? transfer.referenceRate : null;
  const amount = from === undefined ? null : from.amountMinor < 0n ? -from.amountMinor : from.amountMinor;
  return {
    type: detail.type === 'income' || detail.type === 'transfer' ? detail.type : 'expense',
    amountMinor: transfer === null ? amount : transfer.sentMinor,
    categoryId: detail.type === 'transfer' ? null : detail.categoryId,
    accountId: from?.accountId ?? null,
    toAccountId: detail.type === 'transfer' ? (to?.accountId ?? null) : null,
    receivedMinor:
      transfer === null || transfer.receivedCurrency === transfer.sentCurrency ? null : transfer.receivedMinor,
    rateMode: manual === null ? 'reference' : 'manual',
    manualRate: manual === null ? '' : context.locale === 'id' ? manual.replace('.', ',') : manual,
    feeMinor: fee === undefined ? null : -fee.amountMinor,
    feeCategoryId: fee?.categoryId ?? null,
    date: toLocalDate(instant, context.timeZone),
    time: wallTime(instant, context.timeZone),
    description: detail.description ?? '',
    note: detail.note ?? '',
    tags: [...detail.tags],
  };
}

/** Whether closing the form would lose something the user typed or picked (FR-T9). */
export function isFilled(values: TransactionFormValues): boolean {
  return (
    values.amountMinor !== null ||
    values.categoryId !== null ||
    values.toAccountId !== null ||
    values.feeMinor !== null ||
    values.description.trim() !== '' ||
    values.note.trim() !== '' ||
    values.tags.length > 0
  );
}

const byId = (accounts: readonly AccountView[], id: string | null) =>
  id === null ? undefined : accounts.find((account) => account.id === id);

/** The accounts a transfer moves money between, when both are chosen. */
export function transferAccounts(values: TransactionFormValues, accounts: readonly AccountView[]) {
  const from = byId(accounts, values.accountId);
  const to = byId(accounts, values.toAccountId);
  return from === undefined || to === undefined ? null : { from, to };
}

/** A transfer between accounts in different currencies (FR-T4 "Beda mata uang"). */
export function isCrossCurrency(values: TransactionFormValues, accounts: readonly AccountView[]): boolean {
  const pair = values.type === 'transfer' ? transferAccounts(values, accounts) : null;
  return pair !== null && pair.from.currency !== pair.to.currency;
}

/**
 * The orientation the rate is shown and stored in: one unit of the foreign currency in the user's base currency
 * (`1 USD = Rp16.350`) for both IDR → USD and USD → IDR; between two foreign currencies, source → destination.
 */
export function ratePair(from: string, to: string, baseCurrency: string): { base: string; quote: string } {
  return from === baseCurrency ? { base: to, quote: from } : { base: from, quote: to };
}

/** A typed rate (`16.474`, `16474,5` in Indonesian; `16,474.5` in English) as a rate string, or `null`. */
export function parseRateInput(text: string, locale: Locale): string | null {
  const compact = text.replace(/\s/g, '');
  const decimal = locale === 'id' ? compact.replace(/\./g, '').replace(',', '.') : compact.replace(/,/g, '');
  try {
    parseRate(decimal);
    return decimal;
  } catch {
    return null;
  }
}

export interface FxFigures {
  /** The rate the transfer is valued at: the manual one, or the reference. */
  readonly rate: FxRate;
  /** What arrives in the destination currency; the expected amount until "Diterima" is typed. */
  readonly receivedMinor: bigint;
  readonly difference: FxDifference;
  /** Sent ÷ received in the rate's orientation ("kurs efektif Rp16.474"). */
  readonly effectiveRate: string;
  /** Manual rate vs the reference in basis points ("+0,8% dari acuan"); `null` without both. */
  readonly deviationBps: number | null;
}

/**
 * The FX figures of a cross-currency transfer (FR-T4), or `null` while the amount, the accounts, or a usable rate
 * are missing. `reference` is the reference rate between the two currencies; `receivedToBase` values the
 * destination currency in the base currency when neither side is in it.
 */
export function fxFigures(
  values: TransactionFormValues,
  context: {
    readonly accounts: readonly AccountView[];
    readonly baseCurrency: string;
    readonly locale: Locale;
    readonly reference: FxRate | null;
    readonly receivedToBase?: FxRate | null;
  },
): FxFigures | null {
  const pair = transferAccounts(values, context.accounts);
  if (pair === null || pair.from.currency === pair.to.currency || values.amountMinor === null) return null;
  const orientation = ratePair(pair.from.currency, pair.to.currency, context.baseCurrency);
  const manual = parseRateInput(values.manualRate, context.locale);
  const rate =
    values.rateMode === 'manual' ? (manual === null ? null : { ...orientation, rate: manual }) : context.reference;
  if (rate === null) return null;
  const sent = { minor: values.amountMinor, currency: pair.from.currency };
  const expected = convert(sent, pair.to.currency, rate);
  const receivedMinor = values.receivedMinor ?? expected;
  if (receivedMinor <= 0n) return null;
  const received = { minor: receivedMinor, currency: pair.to.currency };
  const toBase = context.receivedToBase ?? null;
  const difference = fxDifference({
    sent,
    received,
    reference: rate,
    baseCurrency: context.baseCurrency,
    ...(toBase === null ? {} : { receivedToBase: toBase }),
  });
  return {
    rate,
    receivedMinor,
    difference,
    effectiveRate: effectiveRate(sent, received, rate),
    deviationBps:
      values.rateMode === 'manual' && manual !== null && context.reference !== null
        ? manualRateDeviationBps(manual, context.reference.rate)
        : null,
  };
}

/** One unit of `rate.base` in `rate.quote` minor units, for "1 USD = Rp16.350". */
export function unitValue(rate: FxRate): bigint {
  return convert({ minor: 10n ** BigInt(currencyInfo(rate.base).minorDigits), currency: rate.base }, rate.quote, rate);
}

export type FieldError = 'required' | 'same_account' | 'invalid';

export interface FormErrors {
  readonly amount?: FieldError;
  readonly category?: FieldError;
  readonly account?: FieldError;
  readonly toAccount?: FieldError;
  readonly received?: FieldError;
  readonly rate?: FieldError;
  readonly feeCategory?: FieldError;
}

/**
 * FR-T8 inline validation: an amount above zero, a category for expenses and incomes, an account, and for transfers
 * a destination other than the source; a cross-currency transfer also needs a usable rate (`figures`).
 */
export function validate(
  values: TransactionFormValues,
  accounts: readonly AccountView[],
  figures: FxFigures | null,
): FormErrors {
  const errors: { -readonly [K in keyof FormErrors]: FormErrors[K] } = {};
  if (values.amountMinor === null || values.amountMinor <= 0n) errors.amount = 'required';
  if (byId(accounts, values.accountId) === undefined) errors.account = 'required';
  if (values.type !== 'transfer') {
    if (values.categoryId === null) errors.category = 'required';
    return errors;
  }
  if (byId(accounts, values.toAccountId) === undefined) errors.toAccount = 'required';
  else if (values.toAccountId === values.accountId) errors.toAccount = 'same_account';
  if (values.feeMinor !== null && values.feeMinor > 0n && values.feeCategoryId === null) {
    errors.feeCategory = 'required';
  }
  if (values.receivedMinor !== null && values.receivedMinor <= 0n) errors.received = 'invalid';
  else if (isCrossCurrency(values, accounts) && errors.amount === undefined && figures === null) {
    // No usable rate: a manual one that does not parse, or no reference rate (yet).
    errors.rate = values.rateMode === 'manual' ? 'invalid' : 'required';
  }
  return errors;
}

/** What leaves the source account: `amount` plus a transfer fee. */
function outflowMinor(values: TransactionFormValues, amount: bigint): bigint {
  const fee = values.type === 'transfer' && values.feeMinor !== null && values.feeMinor > 0n ? values.feeMinor : 0n;
  return amount + fee;
}

export interface Shortfall {
  readonly account: AccountView;
  /** What the expense or transfer (with its fee) takes out. */
  readonly outflowMinor: bigint;
  /** How much the recorded balance is short by (positive). */
  readonly shortMinor: bigint;
}

/**
 * FR-T8: the source account's recorded balance does not cover an expense or transfer. Only a warning; credit cards
 * run negative by design and are never short.
 */
export function shortfall(values: TransactionFormValues, accounts: readonly AccountView[]): Shortfall | null {
  if (values.type === 'income' || values.amountMinor === null || values.amountMinor <= 0n) return null;
  const account = byId(accounts, values.accountId);
  if (account === undefined || account.type === 'credit_card') return null;
  const out = outflowMinor(values, values.amountMinor);
  return account.balanceMinor >= out ? null : { account, outflowMinor: out, shortMinor: out - account.balanceMinor };
}

/** FR-T3: the balances after saving, per account touched (source first). */
export function balancesAfter(
  values: TransactionFormValues,
  accounts: readonly AccountView[],
  figures: FxFigures | null,
): { readonly account: AccountView; readonly afterMinor: bigint }[] {
  const amount = values.amountMinor ?? 0n;
  const source = byId(accounts, values.accountId);
  if (source === undefined || amount <= 0n) return [];
  if (values.type === 'income') return [{ account: source, afterMinor: source.balanceMinor + amount }];
  const after = [{ account: source, afterMinor: source.balanceMinor - outflowMinor(values, amount) }];
  if (values.type === 'expense') return after;
  const destination = byId(accounts, values.toAccountId);
  if (destination === undefined || destination.id === source.id) return after;
  const received = destination.currency === source.currency ? amount : figures?.receivedMinor;
  return received === undefined
    ? after
    : [...after, { account: destination, afterMinor: destination.balanceMinor + received }];
}

const offsetMs = (at: number, timeZone: string): number => {
  // en-US with h23 always yields every one of these parts.
  const part = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(at)
      .map(({ type, value }) => [type, Number(value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
  const wall = Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second);
  return wall - (at - (at % 1000));
};

/** The instant of `date` at `time` (`HH:mm`) on the wall clock of `timeZone`. */
export function zonedInstant(date: LocalDate, time: string, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const [hour, minute] = time.split(':').map(Number) as [number, number];
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const guess = wall - offsetMs(wall, timeZone);
  // A second pass settles instants near a daylight-saving change.
  return new Date(wall - offsetMs(guess, timeZone));
}

/** `HH:mm` of `instant` on the wall clock of `timeZone`. */
export function wallTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    instant,
  );
}

/** FR-T2 date presets: today, yesterday, two days ago, last Saturday, and the first of the month. */
export function datePresets(today: LocalDate): {
  readonly today: LocalDate;
  readonly yesterday: LocalDate;
  readonly twoDaysAgo: LocalDate;
  readonly lastSaturday: LocalDate;
  readonly monthStart: LocalDate;
} {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  return {
    today,
    yesterday: addDays(today, -1),
    twoDaysAgo: addDays(today, -2),
    // Saturday is 6; on a Saturday "Sabtu lalu" is the one a week before.
    lastSaturday: addDays(today, -((weekday + 1) % 7 || 7)),
    monthStart: parseLocalDate(`${today.slice(0, 8)}01`),
  };
}

/**
 * The `recordTransaction` input for valid `values` (check {@link validate} first). A same-currency transfer
 * receives what it sends; a cross-currency one sends a manual rate only in Manual mode.
 */
export function toRecordInput(
  values: TransactionFormValues,
  context: {
    readonly clientId: string;
    readonly timeZone: string;
    readonly source: 'manual' | 'quick';
    readonly accounts: readonly AccountView[];
    readonly figures: FxFigures | null;
  },
): RecordTransactionInput {
  const common = {
    clientId: context.clientId,
    occurredAt: zonedInstant(values.date, values.time, context.timeZone),
    description: values.description.trim() === '' ? null : values.description.trim(),
    note: values.note.trim() === '' ? null : values.note.trim(),
    tags: [...values.tags],
    source: context.source,
  };
  const amount = values.amountMinor ?? 0n;
  if (values.type !== 'transfer') {
    return {
      ...common,
      type: values.type,
      accountId: values.accountId ?? '',
      amountMinor: amount,
      categoryId: values.categoryId,
    };
  }
  const cross = isCrossCurrency(values, context.accounts) ? context.figures : null;
  return {
    ...common,
    type: 'transfer',
    fromAccountId: values.accountId ?? '',
    toAccountId: values.toAccountId ?? '',
    sentMinor: amount,
    receivedMinor: cross === null ? amount : cross.receivedMinor,
    manualRate: cross !== null && values.rateMode === 'manual' ? cross.rate : null,
    fee:
      values.feeMinor !== null && values.feeMinor > 0n && values.feeCategoryId !== null
        ? { minor: values.feeMinor, categoryId: values.feeCategoryId }
        : null,
  };
}

/** The category the Quick Add bar guesses from what was typed: the first whose name is a word of `text`. */
export function guessCategory(
  text: string,
  categories: readonly CategoryView[],
  name: (category: CategoryView) => string,
): CategoryView | null {
  const words = new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3),
  );
  if (words.size === 0) return null;
  return (
    categories.find((category) =>
      name(category)
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .some((word) => words.has(word)),
    ) ?? null
  );
}

const DRAFT_VERSION = 1;

/** What a draft stores (`saveDraft`): JSON, so amounts are decimal strings. */
export type DraftPayload = Record<string, string | number | null | string[]>;

/** The JSON a draft stores: amounts as decimal strings (JSON has no bigint). */
export function toDraftPayload(values: TransactionFormValues): DraftPayload {
  const amount = (minor: bigint | null) => (minor === null ? null : minor.toString());
  return {
    version: DRAFT_VERSION,
    type: values.type,
    amountMinor: amount(values.amountMinor),
    categoryId: values.categoryId,
    accountId: values.accountId,
    toAccountId: values.toAccountId,
    receivedMinor: amount(values.receivedMinor),
    rateMode: values.rateMode,
    manualRate: values.manualRate,
    feeMinor: amount(values.feeMinor),
    feeCategoryId: values.feeCategoryId,
    date: values.date,
    time: values.time,
    description: values.description,
    note: values.note,
    tags: [...values.tags],
  };
}

const KINDS: readonly string[] = ['expense', 'income', 'transfer'];

/** A stored draft back as form values; `null` for a payload this release cannot read. */
export function fromDraftPayload(payload: JsonObject): TransactionFormValues | null {
  const text = (key: string) => (typeof payload[key] === 'string' ? payload[key] : null);
  const minor = (key: string) => {
    const value = text(key);
    return value !== null && /^\d+$/.test(value) ? BigInt(value) : null;
  };
  const type = text('type');
  const date = text('date');
  const time = text('time');
  if (
    payload['version'] !== DRAFT_VERSION ||
    type === null ||
    !KINDS.includes(type) ||
    date === null ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    time === null ||
    !/^\d{2}:\d{2}$/.test(time)
  ) {
    return null;
  }
  const tags = payload['tags'];
  return {
    type: type as EntryKind,
    amountMinor: minor('amountMinor'),
    categoryId: text('categoryId'),
    accountId: text('accountId'),
    toAccountId: text('toAccountId'),
    receivedMinor: minor('receivedMinor'),
    rateMode: text('rateMode') === 'manual' ? 'manual' : 'reference',
    manualRate: text('manualRate') ?? '',
    feeMinor: minor('feeMinor'),
    feeCategoryId: text('feeCategoryId'),
    date: date as LocalDate,
    time,
    description: text('description') ?? '',
    note: text('note') ?? '',
    tags: Array.isArray(tags) ? tags.filter((tag) => typeof tag === 'string') : [],
  };
}
