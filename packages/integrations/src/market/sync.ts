// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Running the quote adapters against the stores (FR-I5, FR-I6, FR-ST4), shared by the worker's `market-server` and
 * `market-byok` jobs and the web's "Tes koneksi" / "Sinkronkan harga". The stores come in as ports (the `@wf/db`
 * repositories satisfy them), so this module stays free of the database:
 * - BYOK: a market's providers are tried in `FALLBACK_ORDER`, each with the user's own key, for the symbols the
 *   previous ones did not answer; results go only to that user's `user_quotes`. A provider paused after a 429 or an
 *   exhausted quota is skipped until its `retryAfter` (`rateLimitDecision`); a run that fails keeps the last prices.
 * - Built-in: CoinMarketCap with the operator's key (one call for the union of symbols per currency, its
 *   `credit_count` counted against the month's 15 000) and fawazahmed0's XAU spot, into the global cache.
 * Every request is logged (`market_api_logs`, never a key); a connection test's are marked `TEST`.
 */
import {
  FALLBACK_ORDER,
  PROVIDER_QUOTAS,
  QUOTA_RESERVE_BPS,
  rateLimitDecision,
  type ByokProvider,
  type CredentialStatus,
  type Market,
  type MarketProvider,
  type ServerProvider,
} from '@wf/domain/market';
import type { MarketAdapters, QuoteProvider } from './adapters.ts';
import {
  nextUtcDay,
  nextUtcMonth,
  type AdapterFailure,
  type AdapterResult,
  type MarketAdapter,
  type MarketCall,
  type QuoteRequest,
} from './http.ts';

/** One priced thing of a user's (or of all users', built-in) in one market and quote currency. */
export interface MarketTarget {
  readonly market: Market;
  readonly currency: string;
  /** The symbol stored for each provider (`meta.symbols[provider]`, else the ticker). */
  readonly symbols: Readonly<Partial<Record<MarketProvider, string>>>;
  /** When the built-in source last priced it (crypto, gold spot); `null` when it never did or has none. */
  readonly serverAsOf: Date | null;
}

/** A user's key as the sync needs it (decrypted; never leaves the server). */
export interface StoredCredential {
  readonly provider: ByokProvider;
  readonly apiKey: string;
  readonly active: boolean;
  readonly status: CredentialStatus;
  readonly quotaUsed: number;
  readonly quotaResetAt: Date | null;
  readonly retryAfter: Date | null;
}

/** Same shape as `@wf/db/market-credentials` `CredentialStatusInput`. */
export interface CredentialUpdate {
  readonly status: CredentialStatus;
  readonly quotaUsed?: number;
  readonly quotaLimit?: number | null;
  readonly quotaResetAt?: Date | null;
  readonly retryAfter?: Date | null;
  readonly testedAt?: Date;
}

export interface QuoteRow<P extends MarketProvider> {
  readonly provider: P;
  readonly symbol: string;
  readonly quoteCurrency: string;
  readonly bucketTs: Date;
  readonly price: string;
  readonly prevClose: string | null;
}

/** Same shape as `@wf/db/market-data` `ApiLogInput`. */
export interface LogEntry {
  readonly provider: MarketProvider;
  readonly endpoint: string;
  readonly httpStatus: number | null;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly errorCode: string | null;
  readonly at: Date;
}

export interface ByokPorts {
  credential: (userId: string, provider: ByokProvider) => Promise<StoredCredential | null>;
  setStatus: (userId: string, provider: ByokProvider, update: CredentialUpdate) => Promise<unknown>;
  recordUserQuotes: (userId: string, quotes: readonly QuoteRow<ByokProvider>[], fetchedAt: Date) => Promise<void>;
  logRequest: (userId: string | null, entry: LogEntry) => Promise<void>;
}

/** A built-in source's state (`market_provider_state`): pause, monthly credits. */
export interface ProviderState {
  readonly status: CredentialStatus | 'unconfigured';
  readonly pausedUntil: Date | null;
  readonly quotaUsed: number;
  readonly quotaLimit: number | null;
  readonly quotaResetAt: Date | null;
}

export interface ServerPorts {
  providerState: (provider: ServerProvider) => Promise<ProviderState | null>;
  setProviderState: (provider: ServerProvider, state: ProviderState, at: Date) => Promise<void>;
  recordServerQuotes: (quotes: readonly QuoteRow<ServerProvider>[], fetchedAt: Date) => Promise<void>;
  logRequest: (userId: null, entry: LogEntry) => Promise<void>;
}

/** Prefix of a connection test's log rows ("Tes koneksi"). */
export const TEST_ENDPOINT_PREFIX = 'TEST ';

/** CoinMarketCap Basic's monthly credits (research §1.4); fetching stops at {@link QUOTA_RESERVE_BPS} short of it. */
export const CMC_MONTHLY_CREDITS = 15_000;

/** Exchange suffixes of IDX tickers at the providers that need one (BBCA → BBCA.JK at EODHD). */
const IDX_SUFFIX: Readonly<Partial<Record<MarketProvider, string>>> = { eodhd: '.JK', marketstack: '.XIDX' };

/** How `stored` is asked at `provider`: IDX tickers without an exchange get the provider's suffix. */
export function requestSymbol(market: Market, provider: MarketProvider, stored: string): string {
  const suffix = market === 'idx_equity' ? IDX_SUFFIX[provider] : undefined;
  return suffix === undefined || stored.includes('.') ? stored : `${stored}${suffix}`;
}

/** The quota meter of a key: the month's or the day's limit of the free tier, with when it resets. */
export function quotaWindow(provider: ByokProvider, now: Date): { limit: number | null; resetAt: Date | null } {
  const { perMonth, perDay } = PROVIDER_QUOTAS[provider];
  if (perMonth !== null) return { limit: perMonth, resetAt: nextUtcMonth(now) };
  if (perDay !== null) return { limit: perDay, resetAt: nextUtcDay(now) };
  return { limit: null, resetAt: null };
}

/** One target's outcome ("hasil per simbol"). */
export interface SymbolResult {
  readonly symbol: string;
  readonly currency: string;
  readonly provider: QuoteProvider | null;
  readonly price: string | null;
  readonly asOf: Date | null;
}

export interface ProviderRun {
  readonly provider: ByokProvider;
  readonly status: CredentialStatus;
  /** Set while the provider is paused (429, quota). */
  readonly pausedUntil: Date | null;
  readonly calls: number;
  readonly results: SymbolResult[];
}

/** The data minute of a quote: its cache slot, so fetching the same data again replaces it. */
const bucketOf = (asOf: Date): Date => new Date(Math.floor(asOf.getTime() / 60_000) * 60_000);

async function logCalls(
  log: (entry: LogEntry) => Promise<void>,
  calls: readonly MarketCall[],
  at: Date,
  prefix = '',
): Promise<void> {
  for (const call of calls) {
    await log({
      provider: call.provider,
      endpoint: `${prefix}${call.endpoint}`,
      httpStatus: call.httpStatus,
      ok: call.ok,
      durationMs: call.durationMs,
      errorCode: call.errorCode,
      at,
    });
  }
}

/** The status and pause a failure leads to (429 / quota → `rateLimitDecision`). */
function failureState(
  failure: AdapterFailure,
  previous: CredentialStatus | ProviderState['status'],
  now: Date,
): { status: CredentialStatus; pausedUntil: Date | null } {
  if (failure.status !== 'rate_limited' && failure.status !== 'quota_exhausted') {
    return { status: failure.status, pausedUntil: null };
  }
  const decision = rateLimitDecision({
    retryAfter: failure.retryAfter,
    quotaResetAt: failure.quotaResetAt?.getTime() ?? null,
    attempt: previous === 'rate_limited' ? 1 : 0,
    now: now.getTime(),
  });
  return { status: decision.status, pausedUntil: new Date(decision.pauseUntil) };
}

/**
 * One BYOK provider for `targets` with the user's `credential` (the poll, a manual sync, or `test`): logs every call,
 * stores the prices for the user, and records the outcome on the key (status, quota meter, pause, test time).
 */
export async function runByokProvider(
  ports: ByokPorts,
  adapter: MarketAdapter,
  input: {
    readonly userId: string;
    readonly credential: StoredCredential;
    readonly targets: readonly MarketTarget[];
    readonly now: Date;
    readonly test?: boolean;
  },
): Promise<ProviderRun> {
  const { userId, credential, targets, now } = input;
  const { provider } = credential;
  const asked = targets.map((target) => {
    const stored = target.symbols[provider] ?? '';
    return {
      target,
      stored,
      request: { symbol: requestSymbol(target.market, provider, stored), currency: target.currency },
    };
  });
  const requests: QuoteRequest[] = asked.map((entry) => entry.request);
  const result: AdapterResult = await adapter.fetchQuotes({ apiKey: credential.apiKey, requests, now });
  await logCalls(
    (entry) => ports.logRequest(userId, entry),
    result.calls,
    now,
    input.test === true ? TEST_ENDPOINT_PREFIX : '',
  );
  const answered = asked.flatMap(({ target, stored, request }) => {
    const quote = result.quotes.find(
      (candidate) =>
        candidate.symbol.toUpperCase() === request.symbol.toUpperCase() && candidate.currency === request.currency,
    );
    return quote === undefined ? [] : [{ target, stored, quote }];
  });
  if (answered.length > 0) {
    await ports.recordUserQuotes(
      userId,
      answered.map(({ stored, quote }) => ({
        provider,
        symbol: stored,
        quoteCurrency: quote.currency,
        bucketTs: bucketOf(quote.asOf),
        price: quote.price,
        prevClose: quote.prevClose,
      })),
      now,
    );
  }
  const window = quotaWindow(provider, now);
  const carried = credential.quotaResetAt !== null && credential.quotaResetAt > now ? credential.quotaUsed : 0;
  // A real-time call of EODHD counts every symbol it carries.
  const used = provider === 'eodhd' && result.failure === null ? requests.length : result.calls.length;
  const { status, pausedUntil } =
    result.failure === null
      ? { status: result.unverified ? ('unverified' as const) : ('connected' as const), pausedUntil: null }
      : failureState(result.failure, credential.status, now);
  await ports.setStatus(userId, provider, {
    status,
    quotaUsed: carried + used,
    quotaLimit: window.limit,
    quotaResetAt: status === 'quota_exhausted' ? pausedUntil : window.resetAt,
    retryAfter: pausedUntil,
    ...(input.test === true ? { testedAt: now } : {}),
  });
  return {
    provider,
    status,
    pausedUntil,
    calls: result.calls.length,
    results: asked.map(({ target, stored }) => {
      const hit = answered.find((entry) => entry.target === target);
      return {
        symbol: stored,
        currency: target.currency,
        provider: hit === undefined ? null : provider,
        price: hit?.quote.price ?? null,
        asOf: hit?.quote.asOf ?? null,
      };
    }),
  };
}

export interface MarketSync {
  readonly market: Market;
  readonly runs: ProviderRun[];
  /** Keys not used: paused until a time, or switched off. */
  readonly skipped: {
    readonly provider: ByokProvider;
    readonly reason: 'paused' | 'inactive';
    readonly until: Date | null;
  }[];
  readonly results: SymbolResult[];
}

/**
 * A market's BYOK providers in fallback order for `targets` (all of one market): each provider with an active, not
 * paused key gets the targets the previous ones left unanswered. Targets nothing answers keep their last price.
 */
export async function syncByokMarket(
  ports: ByokPorts,
  adapters: MarketAdapters,
  input: {
    readonly userId: string;
    readonly market: Market;
    readonly targets: readonly MarketTarget[];
    readonly now: Date;
  },
): Promise<MarketSync> {
  const { userId, market, now } = input;
  const runs: ProviderRun[] = [];
  const skipped: MarketSync['skipped'][number][] = [];
  const answers = new Map<MarketTarget, SymbolResult>();
  for (const step of FALLBACK_ORDER[market]) {
    const remaining = input.targets.filter((target) => !answers.has(target));
    if (step.mode !== 'byok' || step.provider === null || remaining.length === 0) continue;
    const provider = step.provider as ByokProvider;
    const credential = await ports.credential(userId, provider);
    if (credential === null) continue;
    if (!credential.active) {
      skipped.push({ provider, reason: 'inactive', until: null });
      continue;
    }
    if (credential.retryAfter !== null && credential.retryAfter > now) {
      skipped.push({ provider, reason: 'paused', until: credential.retryAfter });
      continue;
    }
    const run = await runByokProvider(ports, adapters[provider], { userId, credential, targets: remaining, now });
    runs.push(run);
    remaining.forEach((target, index) => {
      const result = run.results[index] as SymbolResult;
      if (result.price !== null) answers.set(target, result);
    });
  }
  return {
    market,
    runs,
    skipped,
    results: input.targets.map(
      (target) =>
        answers.get(target) ?? {
          symbol: Object.values(target.symbols)[0] ?? '',
          currency: target.currency,
          provider: null,
          price: null,
          asOf: null,
        },
    ),
  };
}

export interface ServerRun {
  readonly provider: ServerProvider;
  readonly status: ProviderState['status'];
  readonly pausedUntil: Date | null;
  /** Prices stored. */
  readonly quotes: number;
  /** Credits used this month after the run (CoinMarketCap). */
  readonly quotaUsed: number;
  /** Why nothing was asked: no operator key, paused, or the month's credits kept in reserve. */
  readonly skipped: 'unconfigured' | 'paused' | 'credits' | null;
}

/**
 * A built-in source (`coinmarketcap` with the operator's key, `fawazahmed0` keyless) for `requests` (the union of
 * every user's symbols): stores the prices in the global cache, logs the calls as built-in (`user_id` null), and keeps
 * the source's state: paused after a 429 until `Retry-After`, CoinMarketCap's credits counted per month and no call
 * once only the reserve is left.
 */
export async function syncServerProvider(
  ports: ServerPorts,
  adapter: MarketAdapter,
  input: {
    readonly provider: 'coinmarketcap' | 'fawazahmed0';
    readonly apiKey: string | null;
    readonly requests: readonly QuoteRequest[];
    readonly now: Date;
  },
): Promise<ServerRun> {
  const { provider, now } = input;
  const metered = provider === 'coinmarketcap';
  const previous = await ports.providerState(provider);
  const resetAt = metered ? nextUtcMonth(now) : null;
  const carried =
    previous !== null && previous.quotaResetAt !== null && previous.quotaResetAt > now ? previous.quotaUsed : 0;
  const state = (status: ProviderState['status'], pausedUntil: Date | null, quotaUsed: number): ProviderState => ({
    status,
    pausedUntil,
    quotaUsed,
    quotaLimit: metered ? CMC_MONTHLY_CREDITS : null,
    quotaResetAt: resetAt,
  });
  const skip = async (reason: NonNullable<ServerRun['skipped']>, next: ProviderState): Promise<ServerRun> => {
    await ports.setProviderState(provider, next, now);
    return {
      provider,
      status: next.status,
      pausedUntil: next.pausedUntil,
      quotes: 0,
      quotaUsed: carried,
      skipped: reason,
    };
  };
  if (metered && input.apiKey === null) return skip('unconfigured', state('unconfigured', null, carried));
  if (previous?.pausedUntil != null && previous.pausedUntil > now) {
    return skip('paused', state(previous.status, previous.pausedUntil, carried));
  }
  if (metered && carried >= Math.floor((CMC_MONTHLY_CREDITS * (10_000 - QUOTA_RESERVE_BPS)) / 10_000)) {
    return skip('credits', state('quota_exhausted', resetAt, carried));
  }
  if (input.requests.length === 0) {
    return {
      provider,
      status: previous?.status ?? 'connected',
      pausedUntil: null,
      quotes: 0,
      quotaUsed: carried,
      skipped: null,
    };
  }
  const result = await adapter.fetchQuotes({ apiKey: input.apiKey, requests: input.requests, now });
  await logCalls((entry) => ports.logRequest(null, entry), result.calls, now);
  if (result.quotes.length > 0) {
    await ports.recordServerQuotes(
      result.quotes.map((quote) => ({
        provider,
        symbol: quote.symbol,
        quoteCurrency: quote.currency,
        bucketTs: bucketOf(quote.asOf),
        price: quote.price,
        prevClose: quote.prevClose,
      })),
      now,
    );
  }
  const quotaUsed = carried + (result.credits ?? 0);
  const { status, pausedUntil } =
    result.failure === null
      ? { status: 'connected' as const, pausedUntil: null }
      : failureState(result.failure, previous?.status ?? 'connected', now);
  await ports.setProviderState(provider, state(status, pausedUntil, quotaUsed), now);
  return { provider, status, pausedUntil, quotes: result.quotes.length, quotaUsed, skipped: null };
}
