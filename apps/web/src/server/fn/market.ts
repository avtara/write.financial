// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › "API kurs & pasar" (FR-ST4, FR-I5, FR-I6): the sources per asset class with their state, the user's own
 * keys (saved only with 2FA, shown by their last 4 characters, never returned), "Tes koneksi" with per-symbol
 * results, "Sinkronkan harga" per source, and "Buka log API". Requests with the user's key run here (the answer is
 * shown at once) through the egress-allowlisted adapters, and their prices go only to that user's `user_quotes`;
 * built-in sources are never fetched from a request (the worker's cache). The user always comes from the session.
 */
import { createServerFn } from '@tanstack/react-start';
import { LedgerError } from '@wf/db/ledger-errors';
import type { MarketCredentialView } from '@wf/db/market-credentials';
import type { ApiLogView } from '@wf/db/market-data';
import type { ProviderStateView } from '@wf/db/market-jobs';
import {
  BYOK_PROVIDERS,
  STALE_AFTER_MS,
  type ByokProvider,
  type QuoteLabel,
  type MarketProvider,
  type ResolvedQuote,
} from '@wf/domain/market';
import {
  runByokProvider,
  syncByokMarket,
  type ByokPorts,
  type MarketTarget,
  type SymbolResult,
} from '@wf/integrations/market/sync';
import * as z from 'zod';
import {
  LOG_DAYS,
  PROBE_SYMBOLS,
  PROVIDER_MARKET,
  SYNC_MARKETS,
  TEST_SYMBOLS,
  TESTS_PER_HOUR,
  type SyncMarket,
} from '../../lib/market-sources.ts';
import { attempt, requireSession, type Result } from '../access.ts';
import { services, type Services } from '../runtime.ts';

/** Thrown when "Tes koneksi" was pressed {@link TESTS_PER_HOUR} times for a provider within the hour. */
class MarketTestLimitError extends Error {
  override readonly name = 'MarketTestLimitError';
  readonly code = 'MARKET_TEST_LIMIT';
}

export interface MarketSettings {
  readonly twoFactorEnabled: boolean;
  /** The user's keys (last 4 only). */
  readonly keys: MarketCredentialView[];
  /** Prices each key holds. */
  readonly quoteCounts: Partial<Record<ByokProvider, number>>;
  /** The built-in sources' state (pause, CoinMarketCap credits). */
  readonly serverSources: ProviderStateView[];
  /** Whether the instance has the operator's CoinMarketCap key. */
  readonly cmcConfigured: boolean;
  /** Distinct priced things per market (frequency per key). */
  readonly symbolCounts: Partial<Record<SyncMarket, number>>;
  /**
   * The prices the user's assets are valued with now, per label (FR-I5: source and time, never "real-time"): how many
   * and the newest. Empty when nothing is priced (values at cost, FR-G6).
   */
  readonly prices: {
    readonly label: QuoteLabel;
    readonly provider: MarketProvider | null;
    readonly count: number;
    readonly asOf: Date;
  }[];
}

export interface MarketTestResult {
  readonly provider: ByokProvider;
  readonly status: MarketCredentialView['status'];
  readonly pausedUntil: Date | null;
  readonly results: SymbolResult[];
}

export interface MarketSyncResult {
  readonly market: SyncMarket;
  /** `cached`: priced by the built-in source (no request); `no_key`: nothing to ask it with. */
  readonly status: 'synced' | 'partial' | 'failed' | 'paused' | 'no_key' | 'cached';
  readonly synced: number;
  readonly missing: number;
  /** The provider that priced the most. */
  readonly provider: string | null;
  readonly pausedUntil: Date | null;
}

const provider = z.enum(BYOK_PROVIDERS);

function byokPorts(s: Services): ByokPorts {
  return {
    credential: s.marketJobs.credential,
    setStatus: s.marketCredentials.setStatus,
    recordUserQuotes: s.marketData.recordUserQuotes,
    logRequest: s.marketData.logRequest,
    baselineExists: s.marketJobs.baselineExists,
  };
}

export const getMarketSettings = createServerFn({ method: 'GET' }).handler(
  async ({ context }): Promise<Result<MarketSettings>> => {
    const s = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, s.now());
      const targets = await s.marketJobs.userTargets(user.id);
      const symbolCounts: Partial<Record<SyncMarket, number>> = {};
      for (const target of targets) symbolCounts[target.market] = (symbolCounts[target.market] ?? 0) + 1;
      const quotes = [...(await s.marketData.quotes(user.id)).values()].filter(
        (quote): quote is ResolvedQuote => quote !== null,
      );
      const grouped = new Map<string, MarketSettings['prices'][number]>();
      for (const quote of quotes) {
        const key = `${quote.label}:${quote.provider}`;
        const existing = grouped.get(key);
        grouped.set(key, {
          label: quote.label,
          provider: quote.provider ?? null,
          count: (existing?.count ?? 0) + 1,
          asOf: new Date(Math.max(existing?.asOf.getTime() ?? 0, quote.asOf)),
        });
      }
      return {
        twoFactorEnabled: user.twoFactorEnabled === true,
        keys: await s.marketCredentials.list(user.id),
        quoteCounts: await s.marketJobs.quoteCounts(user.id),
        serverSources: await s.marketJobs.providerStates(),
        cmcConfigured: s.config.market.cmcApiKey !== null,
        symbolCounts,
        prices: [...grouped.values()],
      };
    });
  },
);

/** Saves (or replaces) the key: mandatory 2FA (FR-ST4); the answer carries only the last 4 characters. */
export const saveMarketKey = createServerFn({ method: 'POST' })
  .validator(z.object({ provider, apiKey: z.string().trim().min(4).max(512) }))
  .handler(async ({ context, data }): Promise<Result<MarketCredentialView>> => {
    const s = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, { twoFactor: true, fresh: true }, s.now());
      return s.marketCredentials.save(user.id, data);
    });
  });

/** "Aktifkan" / "Nonaktifkan": a switched-off key is not asked (its prices stay until they go stale). */
export const setMarketKeyActive = createServerFn({ method: 'POST' })
  .validator(z.object({ provider, active: z.boolean() }))
  .handler(async ({ context, data }): Promise<Result<MarketCredentialView>> => {
    const s = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, { twoFactor: true }, s.now());
      return s.marketCredentials.setActive(user.id, data.provider, data.active);
    });
  });

/** "Hapus key": the key and every price it fetched for the user go (the providers' terms require it). */
export const removeMarketKey = createServerFn({ method: 'POST' })
  .validator(z.object({ provider }))
  .handler(async ({ context, data }): Promise<Result<{ quotesDeleted: number }>> => {
    const s = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, s.now());
      return s.marketCredentials.remove(user.id, data.provider);
    });
  });

/**
 * "Tes koneksi": asks the provider for up to {@link TEST_SYMBOLS} of the user's symbols in its market (or a well-known
 * one) with the saved key, stores what came back for the user, and records the outcome on the key. At most
 * {@link TESTS_PER_HOUR} an hour per provider (tests use the free quota).
 * @throws `NOT_FOUND` without a key, `MARKET_TEST_LIMIT`
 */
export const testMarketKey = createServerFn({ method: 'POST' })
  .validator(z.object({ provider }))
  .handler(async ({ context, data }): Promise<Result<MarketTestResult>> => {
    const s = await services();
    return attempt(async () => {
      const now = s.now();
      const { user } = await requireSession(context.session, { twoFactor: true }, now);
      const credential = await s.marketJobs.credential(user.id, data.provider);
      if (credential === null) throw new LedgerError('NOT_FOUND', 'No key for this provider');
      const since = new Date(now.getTime() - 3_600_000);
      if ((await s.marketJobs.testsSince(user.id, data.provider, since)) >= TESTS_PER_HOUR) {
        throw new MarketTestLimitError('Too many connection tests this hour');
      }
      const market = PROVIDER_MARKET[data.provider];
      const own = (await s.marketJobs.userTargets(user.id)).filter((target) => target.market === market);
      const probe = PROBE_SYMBOLS[market];
      const targets: MarketTarget[] =
        own.length > 0
          ? own.slice(0, TEST_SYMBOLS)
          : [{ market, currency: probe.currency, symbols: { [data.provider]: probe.symbol }, serverAsOf: null }];
      const run = await runByokProvider(byokPorts(s), s.marketAdapters[data.provider], {
        userId: user.id,
        credential,
        targets,
        now,
        test: true,
      });
      return { provider: data.provider, status: run.status, pausedUntil: run.pausedUntil, results: run.results };
    });
  });

/**
 * "Sinkronkan harga" for one source (the page calls it per market for its progress): the user's keys in fallback
 * order for the user's fetched symbols; crypto and gold only for what the built-in cache has no fresh price for.
 */
export const syncMarketSource = createServerFn({ method: 'POST' })
  .validator(z.object({ market: z.enum(SYNC_MARKETS) }))
  .handler(async ({ context, data }): Promise<Result<MarketSyncResult>> => {
    const s = await services();
    return attempt(async () => {
      const now = s.now();
      const { user } = await requireSession(context.session, { twoFactor: true }, now);
      const { market } = data;
      const targets = (await s.marketJobs.userTargets(user.id, { fetchedOnly: true })).filter(
        (target) =>
          target.market === market &&
          (target.serverAsOf === null || now.getTime() - target.serverAsOf.getTime() > STALE_AFTER_MS[market]),
      );
      const base = { market, synced: 0, missing: targets.length, provider: null, pausedUntil: null };
      if (targets.length === 0) return { ...base, status: 'cached' as const };
      const keys = (await s.marketCredentials.list(user.id)).filter(
        (key) => key.active && PROVIDER_MARKET[key.provider] === market,
      );
      if (keys.length === 0) return { ...base, status: 'no_key' as const };
      const sync = await syncByokMarket(byokPorts(s), s.marketAdapters, { userId: user.id, market, targets, now });
      const synced = sync.results.filter((result) => result.price !== null).length;
      const best = sync.runs
        .map((run) => ({ run, priced: run.results.filter((result) => result.price !== null).length }))
        .sort((a, b) => b.priced - a.priced)[0];
      const pauses = [...sync.runs.map((run) => run.pausedUntil), ...sync.skipped.map((skip) => skip.until)].filter(
        (until): until is Date => until !== null,
      );
      const pausedUntil = pauses.length === 0 ? null : new Date(Math.min(...pauses.map((until) => until.getTime())));
      const status =
        synced === targets.length
          ? ('synced' as const)
          : synced > 0
            ? ('partial' as const)
            : sync.runs.length === 0 && pausedUntil !== null
              ? ('paused' as const)
              : ('failed' as const);
      return {
        market,
        status,
        synced,
        missing: targets.length - synced,
        provider: best === undefined || best.priced === 0 ? null : best.run.provider,
        pausedUntil,
      };
    });
  });

/** "Buka log API": the last {@link LOG_DAYS} days of the user's requests and the built-in fetches, newest first. */
export const getMarketApiLog = createServerFn({ method: 'GET' })
  .validator(z.object({ limit: z.number().int().min(1).max(500).optional() }))
  .handler(async ({ context, data }): Promise<Result<ApiLogView[]>> => {
    const s = await services();
    return attempt(async () => {
      const now = s.now();
      const { user } = await requireSession(context.session, {}, now);
      const since = now.getTime() - LOG_DAYS * 86_400_000;
      return (await s.marketData.apiLog(user.id, data.limit === undefined ? {} : { limit: data.limit })).filter(
        (entry) => entry.at.getTime() >= since,
      );
    });
  });
