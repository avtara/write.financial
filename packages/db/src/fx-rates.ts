// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Exchange rates (plan §4.5 `fx_rates`): built-in rows (`user_id` null) written by the worker's fx job, and manual
 * per-user rows. `referenceRate` resolves a pair for a user: their manual rate → the latest built-in rate → none.
 */
import { formatRate, parseRate } from '@wf/domain/fx';
import type { LocalDate } from '@wf/domain/period';
import { and, desc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { firstRow, withUser, type Database, type Transaction } from './db.ts';
import { LedgerError } from './ledger-errors.ts';
import type { FX_RATE_TYPES } from './schema.ts';
import { fxRates } from './schema.ts';

export type FxRateType = (typeof FX_RATE_TYPES)[number];

/** A resolved rate: 1 `base` = `rate` `quote`. */
export interface ReferenceRate {
  readonly base: string;
  readonly quote: string;
  /** Canonical decimal string (`@wf/domain/fx`). */
  readonly rate: string;
  /** `manual` for the user's own rate, otherwise the built-in provider. */
  readonly provider: string;
  readonly rateType: FxRateType;
  readonly asOf: LocalDate;
  readonly fetchedAt: Date;
  readonly manual: boolean;
}

export interface ManualRate {
  readonly id: string;
  readonly base: string;
  readonly quote: string;
  readonly rate: string;
  readonly asOf: LocalDate;
}

export interface ManualRateInput {
  readonly base: string;
  readonly quote: string;
  readonly rate: string;
  /** Effective from. */
  readonly asOf: LocalDate;
}

export interface BuiltInRateInput {
  readonly base: string;
  readonly quote: string;
  readonly rate: string;
  readonly provider: string;
  readonly rateType: Exclude<FxRateType, 'manual'>;
  readonly asOf: LocalDate;
}

export interface FxRatesRepository {
  /** The user's manual rates, newest first. */
  listManual: (userId: string) => Promise<ManualRate[]>;
  /** Creates or replaces the user's manual rate for the pair and day. */
  upsertManual: (userId: string, input: ManualRateInput) => Promise<ManualRate>;
  /** @throws {LedgerError} `NOT_FOUND` */
  deleteManual: (userId: string, id: string) => Promise<void>;
  /**
   * The rate for `base` → `quote` as of `asOf` (default: any date), from the user's manual rates first, then the
   * latest built-in rate; either orientation is used (an inverse rate is inverted). `null` when none is known.
   */
  referenceRate: (userId: string, base: string, quote: string, asOf?: LocalDate) => Promise<ReferenceRate | null>;
  /** Worker (fx job): inserts or updates built-in rates; returns the number of rows written. */
  upsertGlobal: (rows: readonly BuiltInRateInput[]) => Promise<number>;
  /** Worker: the latest built-in rate for the pair (as stored, no inversion), without a user context. */
  latestGlobal: (base: string, quote: string) => Promise<ReferenceRate | null>;
  /** Worker: every currency code used by any user (accounts, base currencies, manual rates), sorted. */
  currenciesInUse: () => Promise<string[]>;
}

const CURRENCY = /^[A-Z]{3}$/;

/** Validates a pair and rate input and returns the canonical rate string. */
function checkRate(base: string, quote: string, rate: string): string {
  if (!CURRENCY.test(base) || !CURRENCY.test(quote) || base === quote) {
    throw new LedgerError('INVALID_RATE', 'Invalid currency pair');
  }
  try {
    return formatRate(parseRate(rate));
  } catch {
    // parseRate only throws InvalidRateError.
    throw new LedgerError('INVALID_RATE', 'Invalid exchange rate');
  }
}

const COLUMNS = {
  base: fxRates.base,
  quote: fxRates.quote,
  rate: fxRates.rate,
  provider: fxRates.provider,
  rateType: fxRates.rateType,
  asOf: fxRates.asOf,
  fetchedAt: fxRates.fetchedAt,
  userId: fxRates.userId,
};

type RateRow = Pick<typeof fxRates.$inferSelect, keyof typeof COLUMNS>;

function toReference(row: RateRow, invert: boolean): ReferenceRate {
  const scaled = parseRate(row.rate);
  return {
    base: invert ? row.quote : row.base,
    quote: invert ? row.base : row.quote,
    // 1 / rate at 8 fraction digits, rounded half up: 10^16 / scaled.
    rate: invert ? formatRate((10n ** 16n + scaled / 2n) / scaled) : formatRate(scaled),
    provider: row.provider,
    rateType: row.rateType,
    asOf: row.asOf,
    fetchedAt: row.fetchedAt,
    manual: row.userId !== null,
  };
}

/**
 * {@link FxRatesRepository.referenceRate} inside an open user transaction (used by the ledger repositories). Manual
 * rows win over built-in ones; within each, the newest `as_of` (then the latest fetch) wins.
 */
export async function referenceRateIn(
  tx: Transaction,
  base: string,
  quote: string,
  asOf?: LocalDate,
): Promise<ReferenceRate | null> {
  const pair = or(
    and(eq(fxRates.base, base), eq(fxRates.quote, quote)),
    and(eq(fxRates.base, quote), eq(fxRates.quote, base)),
  );
  const [row] = await tx
    .select(COLUMNS)
    .from(fxRates)
    .where(asOf === undefined ? pair : and(pair, lte(fxRates.asOf, asOf)))
    .orderBy(sql`${fxRates.userId} is null`, desc(fxRates.asOf), desc(fxRates.fetchedAt))
    .limit(1);
  return row === undefined ? null : toReference(row, row.base !== base);
}

export function createFxRates(db: Database): FxRatesRepository {
  const manualColumns = {
    id: fxRates.id,
    base: fxRates.base,
    quote: fxRates.quote,
    rate: fxRates.rate,
    asOf: fxRates.asOf,
  };
  const canonical = (row: ManualRate): ManualRate => ({ ...row, rate: formatRate(parseRate(row.rate)) });

  return {
    listManual: (userId) =>
      withUser(db, userId, async (tx) => {
        const rows = await tx
          .select(manualColumns)
          .from(fxRates)
          .where(eq(fxRates.userId, userId))
          .orderBy(desc(fxRates.asOf), fxRates.base, fxRates.quote);
        return rows.map(canonical);
      }),

    upsertManual: (userId, input) => {
      const rate = checkRate(input.base, input.quote, input.rate);
      return withUser(db, userId, async (tx) => {
        const values = {
          ...input,
          rate,
          userId,
          provider: 'manual',
          rateType: 'manual' as const,
          fetchedAt: new Date(),
        };
        const rows = await tx
          .insert(fxRates)
          .values(values)
          .onConflictDoUpdate({
            target: [fxRates.userId, fxRates.base, fxRates.quote, fxRates.asOf],
            targetWhere: sql`${fxRates.userId} is not null`,
            set: { rate, fetchedAt: values.fetchedAt },
          })
          .returning(manualColumns);
        return canonical(firstRow(rows, 'fx_rates'));
      });
    },

    deleteManual: (userId, id) =>
      withUser(db, userId, async (tx) => {
        const rows = await tx
          .delete(fxRates)
          .where(and(eq(fxRates.id, id), eq(fxRates.userId, userId)))
          .returning({ id: fxRates.id });
        if (rows.length === 0) throw new LedgerError('NOT_FOUND', 'No such manual rate');
      }),

    referenceRate: (userId, base, quote, asOf) => withUser(db, userId, (tx) => referenceRateIn(tx, base, quote, asOf)),

    upsertGlobal: async (rows) => {
      if (rows.length === 0) return 0;
      const values = rows.map((row) => ({
        ...row,
        rate: checkRate(row.base, row.quote, row.rate),
        userId: null,
        fetchedAt: new Date(),
      }));
      const written = await db
        .insert(fxRates)
        .values(values)
        .onConflictDoUpdate({
          target: [fxRates.provider, fxRates.base, fxRates.quote, fxRates.asOf],
          targetWhere: sql`${fxRates.userId} is null`,
          set: {
            rate: sql`excluded.rate`,
            rateType: sql`excluded.rate_type`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        })
        .returning({ id: fxRates.id });
      return written.length;
    },

    latestGlobal: async (base, quote) => {
      const [row] = await db
        .select(COLUMNS)
        .from(fxRates)
        .where(and(isNull(fxRates.userId), eq(fxRates.base, base), eq(fxRates.quote, quote)))
        .orderBy(desc(fxRates.asOf), desc(fxRates.fetchedAt))
        .limit(1);
      return row === undefined ? null : toReference(row, false);
    },

    currenciesInUse: async () => {
      const rows = await db.execute<{ code: string }>(sql`select code from fx_currencies_in_use() as code`);
      return rows.map((row) => row.code);
    },
  };
}
