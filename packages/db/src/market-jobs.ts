// SPDX-License-Identifier: AGPL-3.0-only
/**
 * What the market jobs read and keep besides the quotes themselves (plan §6 `market-server`, `market-byok`; FR-ST4):
 * the union of every user's symbols the built-in sources price and the users with a BYOK key (SECURITY DEFINER
 * functions of migration 0013: symbols, currencies, ids, and time zones only), a user's priced assets as sync targets,
 * the user's decrypted key for a request, when each provider was last asked, the connection tests of the last hour,
 * how many of the user's prices each key holds, and the global state of the built-in sources (`market_provider_state`).
 * The shapes match `@wf/integrations/market/sync`'s ports.
 */
import { decryptText } from '@wf/crypto/cipher';
import type { Dek } from '@wf/crypto/envelope';
import type { PriceMode } from '@wf/domain/investments';
import {
  FALLBACK_ORDER,
  type ByokProvider,
  type CredentialStatus,
  type Market,
  type MarketProvider,
  type ServerProvider,
} from '@wf/domain/market';
import { and, count, countDistinct, eq, gte, inArray, like, lt, max, sql } from 'drizzle-orm';
import { firstRow, withUser, type Database } from './db.ts';
import type { WorkerUser } from './dispatch.ts';
import { API_KEY_PURPOSE } from './market-credentials.ts';
import { providerSymbol } from './market-data.ts';
import {
  assets,
  marketApiLogs,
  marketCredentials,
  marketProviderState,
  marketQuotesLatest,
  userQuotes,
  users,
  type PROVIDER_STATE_STATUSES,
} from './schema.ts';

/** Markets whose prices are fetched (the others are typed or computed). */
export const FETCHED_MARKETS = ['us_equity', 'idx_equity', 'crypto', 'gold_spot'] as const satisfies readonly Market[];
export type FetchedMarket = (typeof FETCHED_MARKETS)[number];

/** The built-in source of each fetched market that has one. */
export const SERVER_SOURCE: Readonly<Partial<Record<FetchedMarket, ServerProvider>>> = {
  crypto: 'coinmarketcap',
  gold_spot: 'fawazahmed0',
};

/**
 * Indexes the YTD chips compare with (FR-I3), priced with the user's own keys like a holding: SPY with the US key, IHSG
 * with the IDX key (`JKSE.INDX` at EODHD).
 */
export const BENCHMARK_TARGETS: readonly {
  readonly market: FetchedMarket;
  readonly symbol: string;
  readonly currency: string;
  readonly symbols: Readonly<Partial<Record<MarketProvider, string>>>;
}[] = [
  { market: 'us_equity', symbol: 'SPY', currency: 'USD', symbols: {} },
  { market: 'idx_equity', symbol: 'IHSG', currency: 'IDR', symbols: { eodhd: 'JKSE.INDX' } },
];

/** One thing to price in one market and currency (`@wf/integrations/market/sync` `MarketTarget`). */
export interface MarketTargetRow {
  readonly market: FetchedMarket;
  readonly currency: string;
  readonly symbols: Readonly<Partial<Record<MarketProvider, string>>>;
  readonly serverAsOf: Date | null;
}

/** A symbol a built-in source prices for some user. */
export interface ServerTarget {
  readonly market: 'crypto' | 'gold_spot';
  readonly symbol: string;
  readonly currency: string;
}

/** The user's key as a sync needs it; the key is decrypted and never leaves the server. */
export interface SyncCredential {
  readonly provider: ByokProvider;
  readonly apiKey: string;
  readonly active: boolean;
  readonly status: CredentialStatus;
  readonly quotaUsed: number;
  readonly quotaResetAt: Date | null;
  readonly retryAfter: Date | null;
}

export type ProviderStateStatus = (typeof PROVIDER_STATE_STATUSES)[number];

/** `@wf/integrations/market/sync` `ProviderState`. */
export interface ProviderStateInput {
  readonly status: ProviderStateStatus;
  readonly pausedUntil: Date | null;
  readonly quotaUsed: number;
  readonly quotaLimit: number | null;
  readonly quotaResetAt: Date | null;
}

export interface ProviderStateView extends ProviderStateInput {
  readonly provider: ServerProvider;
  readonly updatedAt: Date;
}

export interface MarketJobs {
  /** Worker: the union of every user's crypto and gold symbols, per quote currency. */
  serverTargets: () => Promise<ServerTarget[]>;
  /** Worker: users with an active key, by id. */
  byokUsers: () => Promise<WorkerUser[]>;
  /**
   * The user's assets of the fetched markets as sync targets (deduplicated), plus the benchmarks; `fetchedOnly` leaves
   * out assets priced by hand or computed (the poll), a connection test keeps them.
   */
  userTargets: (userId: string, options?: { readonly fetchedOnly?: boolean }) => Promise<MarketTargetRow[]>;
  /** The user's key for `provider`, decrypted; `null` without one. */
  credential: (userId: string, provider: ByokProvider) => Promise<SyncCredential | null>;
  /** When the user's requests last went to each provider. */
  lastRequests: (userId: string) => Promise<Partial<Record<MarketProvider, Date>>>;
  /** Connection tests of `provider` since `since` (each test logs its calls with one time). */
  testsSince: (userId: string, provider: ByokProvider, since: Date) => Promise<number>;
  /** Prices each of the user's keys holds (`user_quotes`). */
  quoteCounts: (userId: string) => Promise<Partial<Record<ByokProvider, number>>>;
  /** The built-in sources' state. */
  providerStates: () => Promise<ProviderStateView[]>;
  providerState: (provider: ServerProvider) => Promise<ProviderStateInput | null>;
  /** Worker: keeps a built-in source's state. */
  setProviderState: (provider: ServerProvider, state: ProviderStateInput, at: Date) => Promise<void>;
  /** Worker: deletes API logs older than 30 days, capped at the database clock (FR-ST4). */
  purgeLogs: (at: Date) => Promise<number>;
  /** Whether this user's provider already holds a close from the previous December. */
  baselineExists: (
    userId: string,
    provider: ByokProvider,
    symbol: string,
    currency: string,
    year: number,
  ) => Promise<boolean>;
}

const FETCHED_MODES: readonly PriceMode[] = ['server', 'byok'];

export function createMarketJobs(
  db: Database,
  { getDek }: { readonly getDek: (userId: string) => Promise<Dek> },
): MarketJobs {
  return {
    serverTargets: async () =>
      [
        ...(await db.execute<{ market: ServerTarget['market']; symbol: string; quote_currency: string }>(
          sql`select market, symbol, quote_currency from wf_market_server_targets()`,
        )),
      ].map((row) => ({ market: row.market, symbol: row.symbol, currency: row.quote_currency })),

    byokUsers: async () =>
      [
        ...(await db.execute<{ user_id: string; time_zone: string }>(
          sql`select user_id, time_zone from wf_market_byok_users()`,
        )),
      ].map((row) => ({ userId: row.user_id, timeZone: row.time_zone })),

    userTargets: (userId, { fetchedOnly = false } = {}) =>
      withUser(db, userId, async (tx) => {
        const rows = await tx
          .select({
            symbol: assets.symbol,
            quoteCurrency: assets.quoteCurrency,
            market: assets.market,
            priceMode: assets.priceMode,
            meta: assets.meta,
          })
          .from(assets)
          .where(
            and(
              inArray(assets.market, [...FETCHED_MARKETS]),
              fetchedOnly ? inArray(assets.priceMode, [...FETCHED_MODES]) : undefined,
            ),
          );
        const servers = await tx
          .select({
            provider: marketQuotesLatest.provider,
            symbol: marketQuotesLatest.symbol,
            quoteCurrency: marketQuotesLatest.quoteCurrency,
            bucketTs: marketQuotesLatest.bucketTs,
          })
          .from(marketQuotesLatest)
          .where(inArray(marketQuotesLatest.provider, Object.values(SERVER_SOURCE)));
        const targets = new Map<string, MarketTargetRow>();
        const add = (market: FetchedMarket, currency: string, symbolAt: (provider: MarketProvider) => string) => {
          const symbols = Object.fromEntries(
            FALLBACK_ORDER[market].flatMap((step) =>
              step.provider === null ? [] : [[step.provider, symbolAt(step.provider)]],
            ),
          ) as Partial<Record<MarketProvider, string>>;
          const key = JSON.stringify([market, currency, symbols]);
          if (targets.has(key)) return;
          const server = SERVER_SOURCE[market];
          const cached = servers.find(
            (row) =>
              row.provider === server &&
              row.symbol === symbols[server as MarketProvider] &&
              row.quoteCurrency === currency,
          );
          targets.set(key, { market, currency, symbols, serverAsOf: cached?.bucketTs ?? null });
        };
        for (const row of rows) {
          add(row.market as FetchedMarket, row.quoteCurrency, (provider) => providerSymbol(row, provider));
        }
        for (const benchmark of BENCHMARK_TARGETS) {
          add(benchmark.market, benchmark.currency, (provider) => benchmark.symbols[provider] ?? benchmark.symbol);
        }
        return [...targets.values()];
      }),

    credential: async (userId, provider) => {
      const [row] = await withUser(db, userId, (tx) =>
        tx
          .select({
            apiKeyEnc: marketCredentials.apiKeyEnc,
            active: marketCredentials.active,
            status: marketCredentials.status,
            quotaUsed: marketCredentials.quotaUsed,
            quotaResetAt: marketCredentials.quotaResetAt,
            retryAfter: marketCredentials.retryAfter,
          })
          .from(marketCredentials)
          .innerJoin(users, eq(users.id, marketCredentials.userId))
          .where(and(eq(marketCredentials.provider, provider), eq(users.twoFactorEnabled, true))),
      );
      if (row === undefined) return null;
      const { apiKeyEnc, ...state } = row;
      const apiKey = decryptText(await getDek(userId), apiKeyEnc, { userId, purpose: API_KEY_PURPOSE });
      return { provider, apiKey, ...state };
    },

    lastRequests: (userId) =>
      withUser(db, userId, async (tx) => {
        const rows = await tx
          .select({ provider: marketApiLogs.provider, at: max(marketApiLogs.at) })
          .from(marketApiLogs)
          .where(eq(marketApiLogs.userId, userId))
          .groupBy(marketApiLogs.provider);
        return Object.fromEntries(rows.map((row) => [row.provider, row.at]));
      }),

    testsSince: (userId, provider, since) =>
      withUser(db, userId, async (tx) => {
        const rows = await tx
          .select({ tests: countDistinct(marketApiLogs.at) })
          .from(marketApiLogs)
          .where(
            and(
              eq(marketApiLogs.userId, userId),
              eq(marketApiLogs.provider, provider),
              like(marketApiLogs.endpoint, 'TEST %'),
              gte(marketApiLogs.at, since),
            ),
          );
        return firstRow(rows, 'count').tests;
      }),

    quoteCounts: (userId) =>
      withUser(db, userId, async (tx) => {
        const rows = await tx
          .select({ provider: userQuotes.provider, quotes: count() })
          .from(userQuotes)
          .groupBy(userQuotes.provider);
        return Object.fromEntries(rows.map((row) => [row.provider, row.quotes]));
      }),

    providerStates: async () =>
      (await db.select().from(marketProviderState).orderBy(marketProviderState.provider)).map((row) => ({
        ...row,
        provider: row.provider as ServerProvider,
      })),

    providerState: async (provider) => {
      const [row] = await db.select().from(marketProviderState).where(eq(marketProviderState.provider, provider));
      if (row === undefined) return null;
      const { status, pausedUntil, quotaUsed, quotaLimit, quotaResetAt } = row;
      return { status, pausedUntil, quotaUsed, quotaLimit, quotaResetAt };
    },

    setProviderState: async (provider, state, at) => {
      await db
        .insert(marketProviderState)
        .values({ provider, ...state, updatedAt: at })
        .onConflictDoUpdate({ target: marketProviderState.provider, set: { ...state, updatedAt: at } });
    },

    purgeLogs: async (at) => {
      const rows = await db.execute<{ deleted: string }>(
        sql`select wf_market_purge_logs(${at.toISOString()}::timestamptz) as deleted`,
      );
      return Number(firstRow(rows, 'market retention').deleted);
    },

    baselineExists: (userId, provider, symbol, currency, year) =>
      withUser(db, userId, async (tx) => {
        const rows = await tx
          .select({ symbol: userQuotes.symbol })
          .from(userQuotes)
          .where(
            and(
              eq(userQuotes.provider, provider),
              eq(userQuotes.symbol, symbol),
              eq(userQuotes.quoteCurrency, currency),
              gte(userQuotes.bucketTs, new Date(Date.UTC(year - 1, 11, 20))),
              lt(userQuotes.bucketTs, new Date(Date.UTC(year, 0, 1))),
            ),
          )
          .limit(1);
        return rows.length > 0;
      }),
  };
}
