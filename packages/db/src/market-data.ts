// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Market data (FR-I5, FR-I6): the effective quote of each asset with its source and time, and the caches behind it.
 * Built-in sources live in the global `market_quotes` (written by the worker, read by the app only through the view
 * `market_quotes_latest`); BYOK results live per user in `user_quotes` under Row-Level Security, so one user's key
 * never prices another user's assets. The quote of an asset follows `@wf/domain/market` `resolveQuote`: a manual
 * lock → a computed estimate → the first fresh BYOK result (in the market's fallback order, providers the user has a
 * key for) → a fresh built-in quote → the typed manual price → the newest stale quote ("last", with its date).
 * `null` = nothing known: the asset is valued at cost (FR-G6).
 */
import { formatDecimal, parseDecimal } from '@wf/domain/decimal';
import type { PriceMode } from '@wf/domain/investments';
import {
  BYOK_PROVIDERS,
  FALLBACK_ORDER,
  resolveQuote,
  type ByokProvider,
  type Market,
  type MarketProvider,
  type QuoteCandidate,
  type ResolvedQuote,
  type ServerProvider,
} from '@wf/domain/market';
import { antamEstimate } from '@wf/domain/valuation';
import { asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { withUser, type Database, type Transaction } from './db.ts';
import { LedgerError } from './ledger-errors.ts';
import {
  assets,
  marketApiLogs,
  marketCredentials,
  marketQuotes,
  marketQuotesLatest,
  userQuotes,
  type JsonObject,
} from './schema.ts';

/** What resolving an asset's quote needs from its row. */
export interface QuotedAsset {
  readonly id: string;
  readonly symbol: string;
  readonly quoteCurrency: string;
  readonly market: Market;
  readonly priceMode: PriceMode;
  readonly manualPrice: string | null;
  readonly manualPriceAt: Date | null;
  readonly premiumBps: number | null;
  readonly meta: JsonObject;
}

/** The symbol of an asset at `provider`: `meta.symbols[provider]`, else its ticker (BBCA → `BBCA.JK` at EODHD). */
export function providerSymbol(asset: Pick<QuotedAsset, 'symbol' | 'meta'>, provider: MarketProvider): string {
  const symbols = asset.meta.symbols;
  if (typeof symbols === 'object' && symbols !== null && !Array.isArray(symbols)) {
    const mapped = (symbols as JsonObject)[provider];
    if (typeof mapped === 'string' && mapped.length > 0) return mapped;
  }
  return asset.symbol;
}

/** Spot gold per troy ounce, the base of an Antam estimate (`premium_bps` over it). */
const GOLD_SPOT_SYMBOL = 'XAU';

const normalize = (value: string): string => formatDecimal(parseDecimal(value));

interface CachedQuote {
  readonly provider: MarketProvider;
  readonly symbol: string;
  readonly quoteCurrency: string;
  readonly bucketTs: Date;
  readonly price: string;
  readonly prevClose: string | null;
}

const candidate = (row: CachedQuote): QuoteCandidate => ({
  provider: row.provider,
  price: normalize(row.price),
  prevClose: row.prevClose === null ? null : normalize(row.prevClose),
  asOf: row.bucketTs.getTime(),
});

/**
 * The effective quote of each of `list` (by asset id) as of `now`, inside the user's transaction.
 */
export async function effectiveQuotesIn(
  tx: Transaction,
  list: readonly QuotedAsset[],
  now: Date,
): Promise<Map<string, ResolvedQuote | null>> {
  const result = new Map<string, ResolvedQuote | null>();
  if (list.length === 0) return result;
  const keys = await tx.select({ provider: marketCredentials.provider }).from(marketCredentials);
  const keyed = new Set<MarketProvider>(keys.map((row) => row.provider));
  const symbols = new Set<string>([GOLD_SPOT_SYMBOL]);
  for (const asset of list) {
    for (const step of FALLBACK_ORDER[asset.market]) {
      if (step.provider !== null) symbols.add(providerSymbol(asset, step.provider));
    }
  }
  const own = await tx
    .selectDistinctOn([userQuotes.provider, userQuotes.symbol, userQuotes.quoteCurrency], {
      provider: userQuotes.provider,
      symbol: userQuotes.symbol,
      quoteCurrency: userQuotes.quoteCurrency,
      bucketTs: userQuotes.bucketTs,
      price: userQuotes.price,
      prevClose: userQuotes.prevClose,
    })
    .from(userQuotes)
    .where(inArray(userQuotes.symbol, [...symbols]))
    .orderBy(
      asc(userQuotes.provider),
      asc(userQuotes.symbol),
      asc(userQuotes.quoteCurrency),
      desc(userQuotes.bucketTs),
    );
  const shared = await tx
    .select({
      provider: marketQuotesLatest.provider,
      symbol: marketQuotesLatest.symbol,
      quoteCurrency: marketQuotesLatest.quoteCurrency,
      bucketTs: marketQuotesLatest.bucketTs,
      price: marketQuotesLatest.price,
      prevClose: marketQuotesLatest.prevClose,
    })
    .from(marketQuotesLatest)
    .where(inArray(marketQuotesLatest.symbol, [...symbols]));
  const find = (rows: readonly CachedQuote[], provider: MarketProvider, symbol: string, currency: string) =>
    rows.find((row) => row.provider === provider && row.symbol === symbol && row.quoteCurrency === currency);

  for (const asset of list) {
    const byok: QuoteCandidate[] = [];
    let server: QuoteCandidate | null = null;
    for (const step of FALLBACK_ORDER[asset.market]) {
      if (step.provider === null) continue;
      const symbol = providerSymbol(asset, step.provider);
      if (step.mode === 'byok' && keyed.has(step.provider)) {
        const row = find(own, step.provider, symbol, asset.quoteCurrency);
        if (row !== undefined) byok.push(candidate(row));
      }
      if (step.mode === 'server' && server === null) {
        const row = find(shared, step.provider, symbol, asset.quoteCurrency);
        if (row !== undefined) server = candidate(row);
      }
    }
    const spot = find(shared, 'fawazahmed0', GOLD_SPOT_SYMBOL, asset.quoteCurrency);
    const computed =
      asset.market === 'gold_antam' && asset.premiumBps !== null && spot !== undefined
        ? {
            price: antamEstimate(normalize(spot.price), asset.premiumBps).price,
            prevClose: null,
            asOf: spot.bucketTs.getTime(),
          }
        : null;
    const manual =
      asset.manualPrice === null || asset.manualPriceAt === null
        ? null
        : { price: normalize(asset.manualPrice), prevClose: null, asOf: asset.manualPriceAt.getTime() };
    result.set(
      asset.id,
      resolveQuote({
        market: asset.market,
        priceMode: asset.priceMode,
        manual,
        computed,
        byok,
        server,
        last: null,
        now: now.getTime(),
      }),
    );
  }
  return result;
}

/** A quote of a built-in source, as the worker stores it (global cache). */
export interface ServerQuoteInput {
  readonly provider: ServerProvider;
  readonly symbol: string;
  readonly quoteCurrency: string;
  readonly bucketTs: Date;
  /** Positive decimal string, quote major units. */
  readonly price: string;
  readonly prevClose: string | null;
  readonly sourceAttr?: string | null;
}

/** A result of the user's own key (stored for that user only). */
export interface UserQuoteInput {
  readonly provider: ByokProvider;
  readonly symbol: string;
  readonly quoteCurrency: string;
  readonly bucketTs: Date;
  readonly price: string;
  readonly prevClose: string | null;
}

/** A market data request (`endpoint` already masked: never a key). */
export interface ApiLogInput {
  readonly provider: MarketProvider;
  readonly endpoint: string;
  readonly httpStatus: number | null;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly retry?: number;
  readonly errorCode?: string | null;
  readonly at: Date;
}

export interface ApiLogView extends Required<ApiLogInput> {
  readonly id: string;
  /** `false` for a built-in fetch made for everyone. */
  readonly own: boolean;
}

export interface MarketDataRepository {
  /** The effective quote of each of the user's assets (all when `assetIds` is omitted). */
  quotes: (userId: string, assetIds?: readonly string[]) => Promise<Map<string, ResolvedQuote | null>>;
  /**
   * The user's price for an asset ("Harga" / NAV + date); `lock` makes it the price in force (`price_mode` manual).
   * @throws {LedgerError} `NOT_FOUND`, `INVALID_ASSET`
   */
  setManualPrice: (
    userId: string,
    assetId: string,
    input: { readonly price: string; readonly at: Date; readonly lock?: boolean },
  ) => Promise<void>;
  /** "Buka log API": the user's requests and the built-in fetches, newest first. */
  apiLog: (userId: string, options?: { readonly limit?: number }) => Promise<ApiLogView[]>;
  /** Worker (`wf_worker`, no user): stores built-in quotes (one row per provider, symbol, currency, slot). */
  recordServerQuotes: (quotes: readonly ServerQuoteInput[], fetchedAt: Date) => Promise<void>;
  /** Worker, in the user's job: stores the results of the user's key. */
  recordUserQuotes: (userId: string, quotes: readonly UserQuoteInput[], fetchedAt: Date) => Promise<void>;
  /** Worker or app: logs a request; `userId` null = a built-in fetch. */
  logRequest: (userId: string | null, entry: ApiLogInput) => Promise<void>;
}

const checkPrice = (price: string): string => {
  let scaled: bigint;
  try {
    scaled = parseDecimal(price);
  } catch {
    throw new LedgerError('INVALID_ASSET', 'The price must be a decimal');
  }
  if (scaled <= 0n) throw new LedgerError('INVALID_ASSET', 'The price must be positive');
  return formatDecimal(scaled);
};

export function createMarketData(db: Database, options: { readonly now?: () => Date } = {}): MarketDataRepository {
  const now = options.now ?? (() => new Date());
  return {
    quotes: (userId, assetIds) =>
      withUser(db, userId, async (tx) => {
        const rows = await tx
          .select({
            id: assets.id,
            symbol: assets.symbol,
            quoteCurrency: assets.quoteCurrency,
            market: assets.market,
            priceMode: assets.priceMode,
            manualPrice: assets.manualPrice,
            manualPriceAt: assets.manualPriceAt,
            premiumBps: assets.premiumBps,
            meta: assets.meta,
          })
          .from(assets)
          .where(assetIds === undefined ? undefined : inArray(assets.id, [...assetIds]));
        return effectiveQuotesIn(tx, rows, now());
      }),

    setManualPrice: (userId, assetId, input) =>
      withUser(db, userId, async (tx) => {
        const price = checkPrice(input.price);
        const updated = await tx
          .update(assets)
          .set({
            manualPrice: price,
            manualPriceAt: input.at,
            ...(input.lock === true ? { priceMode: 'manual' as const } : {}),
            updatedAt: now(),
          })
          .where(eq(assets.id, assetId))
          .returning({ id: assets.id });
        if (updated.length === 0) throw new LedgerError('NOT_FOUND', 'No such asset');
      }),

    apiLog: (userId, { limit = 100 } = {}) =>
      withUser(db, userId, async (tx) => {
        const rows = await tx
          .select()
          .from(marketApiLogs)
          .where(or(isNull(marketApiLogs.userId), eq(marketApiLogs.userId, userId)))
          .orderBy(desc(marketApiLogs.at), desc(marketApiLogs.id))
          .limit(Math.min(Math.max(limit, 1), 500));
        return rows.map(({ userId: owner, ...row }) => ({ ...row, own: owner !== null }));
      }),

    recordServerQuotes: async (quotes, fetchedAt) => {
      if (quotes.length === 0) return;
      await db.transaction(async (tx) => {
        for (const quote of quotes) {
          const values = {
            ...quote,
            price: checkPrice(quote.price),
            prevClose: quote.prevClose === null ? null : checkPrice(quote.prevClose),
            sourceAttr: quote.sourceAttr ?? null,
            fetchedAt,
          };
          await tx
            .insert(marketQuotes)
            .values(values)
            .onConflictDoUpdate({
              target: [marketQuotes.provider, marketQuotes.symbol, marketQuotes.quoteCurrency, marketQuotes.bucketTs],
              set: { price: values.price, prevClose: values.prevClose, sourceAttr: values.sourceAttr, fetchedAt },
            });
        }
      });
    },

    recordUserQuotes: (userId, quotes, fetchedAt) =>
      withUser(db, userId, async (tx) => {
        for (const quote of quotes) {
          if (!(BYOK_PROVIDERS as readonly string[]).includes(quote.provider)) {
            throw new LedgerError('INVALID_MARKET_CREDENTIAL', 'Not a BYOK provider');
          }
          const values = {
            ...quote,
            userId,
            price: checkPrice(quote.price),
            prevClose: quote.prevClose === null ? null : checkPrice(quote.prevClose),
            fetchedAt,
          };
          await tx
            .insert(userQuotes)
            .values(values)
            .onConflictDoUpdate({
              target: [
                userQuotes.userId,
                userQuotes.provider,
                userQuotes.symbol,
                userQuotes.quoteCurrency,
                userQuotes.bucketTs,
              ],
              set: { price: values.price, prevClose: values.prevClose, fetchedAt },
            });
        }
      }),

    logRequest: async (userId, entry) => {
      const values = { ...entry, userId, retry: entry.retry ?? 0, errorCode: entry.errorCode ?? null };
      if (userId === null) {
        await db.insert(marketApiLogs).values(values);
        return;
      }
      await withUser(db, userId, async (tx) => {
        await tx.insert(marketApiLogs).values(values);
      });
    },
  };
}

/** Rows of `user_quotes` a deleted key leaves behind (FR-ST4: deleted with the key). */
export async function deleteUserQuotesIn(tx: Transaction, provider: MarketProvider): Promise<number> {
  const deleted = await tx
    .delete(userQuotes)
    .where(eq(userQuotes.provider, provider))
    .returning({ symbol: userQuotes.symbol });
  return deleted.length;
}
