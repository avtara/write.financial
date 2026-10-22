// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Market data policy (PRD FR-I5, FR-I6, FR-ST4; docs/research/market-data.md): the providers, the fallback order
 * per market, which quote an asset uses and how it is labelled ("tertunda"/"penutupan", never "real-time"), the
 * refresh frequency a BYOK key's free quota allows, the pause after HTTP 429, and the egress allowlist every adapter
 * must check before a request. Pure: no network, no clock (times are epoch milliseconds passed in).
 */
import type { PriceMode } from './investments.ts';

/** Built-in sources the server fetches once for everyone (global cache `market_quotes`). */
export const SERVER_PROVIDERS = ['frankfurter', 'fawazahmed0', 'open_er_api', 'coinmarketcap'] as const;
export type ServerProvider = (typeof SERVER_PROVIDERS)[number];

/** Sources used with the user's own key; results stay with that user (`user_quotes`). */
export const BYOK_PROVIDERS = [
  'tiingo',
  'finnhub',
  'massive',
  'alpha_vantage',
  'eodhd',
  'marketstack',
  'coinmarketcap',
  'coingecko',
  'goldapi',
  'metals_dev',
] as const;
export type ByokProvider = (typeof BYOK_PROVIDERS)[number];

export const MARKET_PROVIDERS = [
  'frankfurter',
  'fawazahmed0',
  'open_er_api',
  'coinmarketcap',
  'tiingo',
  'finnhub',
  'massive',
  'alpha_vantage',
  'eodhd',
  'marketstack',
  'coingecko',
  'goldapi',
  'metals_dev',
] as const;
export type MarketProvider = (typeof MARKET_PROVIDERS)[number];

/** Where an asset's effective quote came from. */
export const QUOTE_SOURCES = ['byok', 'manual', 'server', 'computed', 'last'] as const;
export type QuoteSource = (typeof QUOTE_SOURCES)[number];

/** FR-ST4 status of a BYOK key ("Belum diuji", "Terhubung", "Key salah", "Kuota habis s.d. …", …). */
export const CREDENTIAL_STATUSES = [
  'untested',
  'connected',
  'unverified',
  'invalid_key',
  'quota_exhausted',
  'rate_limited',
  'error',
] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

/**
 * The market a price comes from (FR-I6 rows), independent of the asset class: VEA is class "Internasional" but a US
 * ETF priced like SPY.
 */
export const MARKETS = [
  'fx',
  'us_equity',
  'idx_equity',
  'crypto',
  'gold_spot',
  'gold_antam',
  'mutual_fund',
  'sbn',
] as const;
export type Market = (typeof MARKETS)[number];

export interface SourceStep {
  readonly mode: PriceMode;
  /** `null` for manual and computed steps. */
  readonly provider: MarketProvider | null;
}

const server = (provider: ServerProvider): SourceStep => ({ mode: 'server', provider });
const byok = (provider: ByokProvider): SourceStep => ({ mode: 'byok', provider });
const MANUAL: SourceStep = { mode: 'manual', provider: null };
const COMPUTED: SourceStep = { mode: 'computed', provider: null };

/**
 * FR-I6 / research §2.8 fallback order per market. Not listed on purpose (prohibited or unlicensed for a shared
 * service): unofficial Yahoo Finance, Stooq, Twelve Data/FMP free, scraping, Indodax, CMC keyless.
 */
export const FALLBACK_ORDER: Readonly<Record<Market, readonly SourceStep[]>> = {
  fx: [server('frankfurter'), server('fawazahmed0'), server('open_er_api'), MANUAL],
  us_equity: [byok('tiingo'), byok('finnhub'), byok('massive'), byok('alpha_vantage'), MANUAL],
  idx_equity: [byok('eodhd'), byok('marketstack'), MANUAL],
  crypto: [server('coinmarketcap'), byok('coinmarketcap'), byok('coingecko'), MANUAL],
  gold_spot: [server('fawazahmed0'), byok('goldapi'), byok('metals_dev'), MANUAL],
  gold_antam: [MANUAL, COMPUTED],
  mutual_fund: [MANUAL, COMPUTED],
  sbn: [COMPUTED, MANUAL],
};

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * Age after which a quote counts as stale ("per {tanggal}"): a few polling intervals for crypto, a long weekend
 * (+ a holiday) for daily and exchange closes, a week for a typed NAV.
 */
export const STALE_AFTER_MS: Readonly<Record<Market, number>> = {
  fx: 4 * DAY,
  us_equity: 4 * DAY,
  idx_equity: 4 * DAY,
  crypto: 60 * MINUTE,
  gold_spot: 4 * DAY,
  gold_antam: 4 * DAY,
  mutual_fund: 7 * DAY,
  sbn: 31 * DAY,
};

/** Delayed intraday feeds ("tertunda") vs end-of-day closes ("penutupan"); nothing is ever "real-time". */
export const PROVIDER_FEEDS: Readonly<Record<MarketProvider, 'delayed' | 'close'>> = {
  frankfurter: 'close',
  fawazahmed0: 'close',
  open_er_api: 'close',
  coinmarketcap: 'delayed',
  tiingo: 'delayed',
  finnhub: 'delayed',
  massive: 'close',
  alpha_vantage: 'close',
  eodhd: 'close',
  marketstack: 'close',
  coingecko: 'delayed',
  goldapi: 'delayed',
  metals_dev: 'delayed',
};

/** FR-I5 label of a displayed price. There is deliberately no "real-time" label. */
export const QUOTE_LABELS = ['delayed', 'close', 'manual', 'estimate', 'last'] as const;
export type QuoteLabel = (typeof QUOTE_LABELS)[number];

export interface QuoteCandidate {
  readonly provider: MarketProvider;
  readonly price: string;
  readonly prevClose: string | null;
  /** Epoch milliseconds of the data (not of the fetch). */
  readonly asOf: number;
}

export interface TypedQuote {
  readonly price: string;
  readonly prevClose: string | null;
  readonly asOf: number;
}

export interface QuoteInput {
  readonly market: Market;
  readonly priceMode: PriceMode;
  readonly manual: TypedQuote | null;
  readonly computed: TypedQuote | null;
  /** The user's BYOK results in the user's fallback order. */
  readonly byok: readonly QuoteCandidate[];
  readonly server: QuoteCandidate | null;
  /** The last quote shown for the asset (any source). */
  readonly last: QuoteCandidate | null;
  readonly now: number;
}

export interface ResolvedQuote {
  readonly price: string;
  readonly prevClose: string | null;
  readonly source: QuoteSource;
  readonly provider: MarketProvider | null;
  readonly asOf: number;
  readonly stale: boolean;
  readonly label: QuoteLabel;
}

/**
 * The quote an asset is valued with (plan §5, research §2.0.3): a manual lock (`priceMode` manual) → the computed
 * estimate (`priceMode` computed) → the first fresh BYOK result → a fresh server quote → the typed manual price →
 * the newest stale quote, labelled "last" with its date. `null` when nothing is known (FR-G6: shown at cost).
 */
export function resolveQuote(input: QuoteInput): ResolvedQuote | null {
  const maxAge = STALE_AFTER_MS[input.market];
  const stale = (asOf: number): boolean => input.now - asOf > maxAge;
  const typed = (quote: TypedQuote, source: 'manual' | 'computed'): ResolvedQuote => ({
    ...quote,
    source,
    provider: null,
    stale: stale(quote.asOf),
    label: source === 'manual' ? 'manual' : 'estimate',
  });
  if (input.priceMode === 'manual' && input.manual !== null) return typed(input.manual, 'manual');
  if (input.priceMode === 'computed' && input.computed !== null) return typed(input.computed, 'computed');
  const fetched: [QuoteCandidate, 'byok' | 'server'][] = [
    ...input.byok.map((candidate): [QuoteCandidate, 'byok'] => [candidate, 'byok']),
    ...(input.server === null ? [] : [[input.server, 'server'] as [QuoteCandidate, 'server']]),
  ];
  const fresh = fetched.find(([candidate]) => !stale(candidate.asOf));
  if (fresh !== undefined) {
    const [candidate, source] = fresh;
    return { ...candidate, source, stale: false, label: PROVIDER_FEEDS[candidate.provider] };
  }
  if (input.manual !== null) return typed(input.manual, 'manual');
  const newest = [
    ...fetched.map(([candidate]) => candidate),
    ...(input.last === null ? [] : [input.last]),
  ].reduce<QuoteCandidate | null>(
    (best, candidate) => (best === null || candidate.asOf > best.asOf ? candidate : best),
    null,
  );
  if (newest === null) return null;
  return { ...newest, source: 'last', stale: true, label: 'last' };
}

/** How a provider counts calls and what its free tier allows (research §1–§3); `null` = no such limit. */
export interface ProviderQuota {
  /** Symbols one call can carry (`1` = one call per symbol). */
  readonly symbolsPerCall: number;
  readonly perMinute: number | null;
  readonly perHour: number | null;
  readonly perDay: number | null;
  readonly perMonth: number | null;
  /** Shortest interval offered during the session; `null` = only a few fixed refreshes per day. */
  readonly minIntervalMinutes: number | null;
  /** End-of-day data only: one refresh a day after the close. */
  readonly eodOnly: boolean;
}

const quota = (
  symbolsPerCall: number,
  limits: Partial<
    Pick<ProviderQuota, 'perMinute' | 'perHour' | 'perDay' | 'perMonth' | 'minIntervalMinutes' | 'eodOnly'>
  >,
): ProviderQuota => ({
  symbolsPerCall,
  perMinute: null,
  perHour: null,
  perDay: null,
  perMonth: null,
  minIntervalMinutes: null,
  eodOnly: false,
  ...limits,
});

/**
 * Free-tier quotas of the BYOK providers (research §1.2–§1.5, §2.9, §4.2.9: CoinGecko defaults to 10 minutes so the
 * user's key keeps room).
 */
export const PROVIDER_QUOTAS: Readonly<Record<ByokProvider, ProviderQuota>> = {
  tiingo: quota(100, { perHour: 50, perDay: 1000, minIntervalMinutes: 15 }),
  finnhub: quota(1, { perMinute: 60, minIntervalMinutes: 15 }),
  massive: quota(10_000, { perMinute: 5, eodOnly: true }),
  alpha_vantage: quota(1, { perDay: 25, eodOnly: true }),
  eodhd: quota(1, { perMinute: 20, perDay: 20, minIntervalMinutes: 15 }),
  marketstack: quota(100, { perMonth: 100, eodOnly: true }),
  coinmarketcap: quota(100, { perMinute: 50, perMonth: 15_000, minIntervalMinutes: 5 }),
  coingecko: quota(100, { perMinute: 100, perMonth: 10_000, minIntervalMinutes: 10 }),
  goldapi: quota(1, { perMonth: 100 }),
  metals_dev: quota(100, { perMonth: 100 }),
};

/** Trading session minutes per day and polled days per month (research §4.2.10). */
export const MARKET_SESSIONS: Readonly<
  Record<Market, { readonly minutesPerDay: number; readonly daysPerMonth: number }>
> = {
  fx: { minutesPerDay: 1440, daysPerMonth: 31 },
  us_equity: { minutesPerDay: 390, daysPerMonth: 23 },
  idx_equity: { minutesPerDay: 435, daysPerMonth: 23 },
  crypto: { minutesPerDay: 1440, daysPerMonth: 31 },
  gold_spot: { minutesPerDay: 1440, daysPerMonth: 31 },
  gold_antam: { minutesPerDay: 1440, daysPerMonth: 31 },
  mutual_fund: { minutesPerDay: 1440, daysPerMonth: 31 },
  sbn: { minutesPerDay: 1440, daysPerMonth: 31 },
};

/** Share of every quota kept free for "Tes koneksi" and retries (EODHD: 16 of 20 calls/day used). */
export const QUOTA_RESERVE_BPS = 1000;

/** Intervals offered during a session, and fixed refreshes per day (EODHD: close + 10.00/12.00/14.30). */
const INTERVALS_MINUTES = [5, 10, 15, 30, 60, 120] as const;
const DAILY_REFRESHES = [4, 3, 2, 1] as const;

export interface RefreshPlan {
  /** Minutes between refreshes during the session; `null` for a few fixed refreshes per day. */
  readonly intervalMinutes: number | null;
  readonly refreshesPerDay: number;
  readonly callsPerRefresh: number;
  readonly callsPerDay: number;
  readonly callsPerMonth: number;
}

/**
 * FR-ST4 "frekuensi dibatasi agar muat kuota gratis": the most refreshes per day that keep `symbolCount` symbols of
 * `market` within every limit of the provider's free tier minus {@link QUOTA_RESERVE_BPS}. `null` when not even one
 * refresh a day fits (too many symbols for the key). Tiingo 15 US → every 15 min (26/day); Alpha Vantage → 1×/day;
 * EODHD 4 IDX → 4×/day (16); CoinMarketCap 3 crypto → 5 min (8.928/month); GoldAPI → 2×/day.
 */
export function refreshPlan(provider: ByokProvider, market: Market, symbolCount: number): RefreshPlan | null {
  if (!Number.isInteger(symbolCount) || symbolCount < 1) {
    throw new RangeError(`Symbol count must be ≥ 1: ${symbolCount}`);
  }
  const limits = PROVIDER_QUOTAS[provider];
  const session = MARKET_SESSIONS[market];
  const callsPerRefresh = Math.ceil(symbolCount / limits.symbolsPerCall);
  const fits = (calls: number, limit: number | null): boolean =>
    limit === null || calls <= Math.floor((limit * (10_000 - QUOTA_RESERVE_BPS)) / 10_000);
  const { minIntervalMinutes } = limits;
  const intervals = INTERVALS_MINUTES.filter(
    (minutes) => minIntervalMinutes !== null && minutes >= minIntervalMinutes,
  ).map((minutes) => ({ intervalMinutes: minutes, refreshesPerDay: Math.floor(session.minutesPerDay / minutes) }));
  const daily = (limits.eodOnly ? [1] : DAILY_REFRESHES).map((count) => ({
    intervalMinutes: null,
    refreshesPerDay: count,
  }));
  // Most refreshes first; for the same count an interval comes before fixed times (stable sort).
  const candidates = [...intervals, ...daily].sort((a, b) => b.refreshesPerDay - a.refreshesPerDay);
  for (const candidate of candidates) {
    const callsPerDay = callsPerRefresh * candidate.refreshesPerDay;
    const callsPerMonth = callsPerDay * session.daysPerMonth;
    // An interval puts 60 ÷ interval refreshes in one hour; fixed daily refreshes are hours apart (one per hour).
    const perHour = callsPerRefresh * Math.ceil(60 / (candidate.intervalMinutes ?? 60));
    if (
      fits(callsPerRefresh, limits.perMinute) &&
      fits(perHour, limits.perHour) &&
      fits(callsPerDay, limits.perDay) &&
      fits(callsPerMonth, limits.perMonth)
    ) {
      return { ...candidate, callsPerRefresh, callsPerDay, callsPerMonth };
    }
  }
  return null;
}

export interface RateLimitInput {
  /** The `Retry-After` header: delta seconds or an HTTP date; `null` when absent. */
  readonly retryAfter: string | null;
  /** When the provider's quota resets, if it said so (`x-ratelimit-reset`, CMC 1009/1010, metals.dev 1203). */
  readonly quotaResetAt: number | null;
  /** Consecutive 429s so far for this provider (0 for the first). */
  readonly attempt: number;
  readonly now: number;
}

export interface RateLimitDecision {
  /** No request to this provider before this time ("jeda sampai {reset}"). */
  readonly pauseUntil: number;
  /** Credential status to show meanwhile. */
  readonly status: Extract<CredentialStatus, 'rate_limited' | 'quota_exhausted'>;
  /** Always: the next source in {@link FALLBACK_ORDER} serves meanwhile. */
  readonly fallBack: true;
}

/** Backoff without any hint: 1 minute doubling per consecutive 429, at most 1 hour. */
const BACKOFF_BASE_MS = MINUTE;
const BACKOFF_MAX_MS = 60 * MINUTE;

/** `Retry-After` as a time: delta seconds, or an HTTP date never earlier than `now`; `null` when absent or unreadable. */
function retryAfterAt(header: string | null, now: number): number | null {
  if (header === null) return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) return now + Number(value) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(date, now);
}

/**
 * FR-ST4 / M5 exit "429 pauses until retry-after": pause until `Retry-After` (seconds or HTTP date, never in the
 * past), else until the quota reset ("Kuota habis s.d. …"), else exponential backoff; then fall back.
 */
export function rateLimitDecision(input: RateLimitInput): RateLimitDecision {
  const retryAt = retryAfterAt(input.retryAfter, input.now);
  if (retryAt !== null) return { pauseUntil: retryAt, status: 'rate_limited', fallBack: true };
  const resetAt = input.quotaResetAt ?? input.now;
  if (resetAt > input.now) return { pauseUntil: resetAt, status: 'quota_exhausted', fallBack: true };
  const backoff = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(input.attempt, 0), BACKOFF_MAX_MS);
  return { pauseUntil: input.now + backoff, status: 'rate_limited', fallBack: true };
}

/**
 * Hosts each adapter may call (M5 exit "no requests to disallowed domains"). `*.` allows exactly one extra label
 * (fawazahmed0's `latest.` and dated `2026-10-16.currency-api.pages.dev` fallbacks).
 */
export const EGRESS_ALLOWLIST: Readonly<Record<MarketProvider, readonly string[]>> = {
  frankfurter: ['api.frankfurter.dev'],
  fawazahmed0: ['cdn.jsdelivr.net', '*.currency-api.pages.dev'],
  open_er_api: ['open.er-api.com'],
  coinmarketcap: ['pro-api.coinmarketcap.com'],
  tiingo: ['api.tiingo.com'],
  finnhub: ['finnhub.io'],
  massive: ['api.massive.com'],
  alpha_vantage: ['www.alphavantage.co'],
  eodhd: ['eodhd.com'],
  marketstack: ['api.marketstack.com'],
  coingecko: ['api.coingecko.com'],
  goldapi: ['www.goldapi.io'],
  metals_dev: ['api.metals.dev'],
};

/** Whether `provider`'s adapter may request `url`: HTTPS, default port, no credentials, an allowlisted host. */
export function isEgressAllowed(provider: MarketProvider, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' || parsed.port !== '' || parsed.username !== '' || parsed.password !== '')
    return false;
  const host = parsed.hostname;
  return EGRESS_ALLOWLIST[provider].some((allowed) => {
    if (!allowed.startsWith('*.')) return host === allowed;
    const suffix = allowed.slice(1);
    const label = host.slice(0, -suffix.length);
    return host.endsWith(suffix) && label !== '' && !label.includes('.');
  });
}
