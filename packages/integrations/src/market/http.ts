// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The shared request layer of the market data adapters (FR-I5, FR-I6, M5 exit "no requests to disallowed domains"):
 * every request is checked against `@wf/domain/market` `isEgressAllowed` before it leaves, refuses redirects, times
 * out, and is recorded as a {@link MarketCall} for the API log — with the path only, never the query string or a
 * header, so a key in either never reaches the log. The shapes adapters answer with live here too.
 */
import { formatDecimal, parseDecimal } from '@wf/domain/decimal';
import { isEgressAllowed, type CredentialStatus, type MarketProvider } from '@wf/domain/market';

export const MARKET_TIMEOUT_MS = 10_000;

export interface MarketHttpOptions {
  /** Defaults to the global `fetch` (looked up per request, so a test seam can replace it). */
  readonly fetch?: typeof fetch;
  /** Per request; defaults to {@link MARKET_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

/** One request as the API log shows it ("GET /iex · spy,qqq"); `endpoint` never contains a key. */
export interface MarketCall {
  readonly provider: MarketProvider;
  readonly endpoint: string;
  /** `null` when no response arrived (timeout, network). */
  readonly httpStatus: number | null;
  readonly ok: boolean;
  readonly durationMs: number;
  readonly errorCode: string | null;
}

/** Thrown before a request to a host outside the provider's allowlist; nothing is sent. */
export class EgressDeniedError extends Error {
  override readonly name = 'EgressDeniedError';
  readonly provider: MarketProvider;

  constructor(provider: MarketProvider, url: string) {
    let origin = 'an invalid URL';
    try {
      origin = new URL(url).origin;
    } catch {
      // keeps the placeholder
    }
    super(`${provider}: egress to ${origin} is not allowed`);
    this.provider = provider;
  }
}

export interface MarketResponse {
  /** `null` when no response arrived. */
  readonly status: number | null;
  readonly headers: Headers;
  /** The JSON body; `undefined` when there was none or it was not JSON. */
  readonly body: unknown;
  readonly durationMs: number;
  /** `timeout` or `network` when no response arrived. */
  readonly transportError: 'timeout' | 'network' | null;
}

/**
 * GETs `url` for `provider` with `headers`. Refuses (throws {@link EgressDeniedError}) a URL the provider may not
 * reach; any other failure is an answer with `status: null`.
 */
export async function marketGet(
  provider: MarketProvider,
  url: string,
  headers: Readonly<Record<string, string>>,
  options: MarketHttpOptions = {},
): Promise<MarketResponse> {
  if (!isEgressAllowed(provider, url)) throw new EgressDeniedError(provider, url);
  const fetchFn = options.fetch ?? globalThis.fetch;
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  let response: Response;
  try {
    response = await fetchFn(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'write.financial', ...headers },
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? MARKET_TIMEOUT_MS),
    });
  } catch (error) {
    const timeout = error instanceof DOMException && error.name === 'TimeoutError';
    return {
      status: null,
      headers: new Headers(),
      body: undefined,
      durationMs: elapsed(),
      transportError: timeout ? 'timeout' : 'network',
    };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  return { status: response.status, headers: response.headers, body, durationMs: elapsed(), transportError: null };
}

/** "GET /v1/quote · spy": the URL's path and a summary of what was asked, without the query string. */
export function endpointOf(url: string, summary: string): string {
  const { pathname } = new URL(url);
  return summary === '' ? `GET ${pathname}` : `GET ${pathname} · ${summary}`;
}

/** At most 5 symbols, then "+N" ("BBCA.JK, VOO, QQQ +5" in the log). */
export function symbolSummary(symbols: readonly string[]): string {
  const shown = symbols.slice(0, 5).join(',');
  return symbols.length > 5 ? `${shown} +${symbols.length - 5}` : shown;
}

/** What a symbol is asked as at the provider, and the currency its price must be in. */
export interface QuoteRequest {
  readonly symbol: string;
  readonly currency: string;
}

/** A price as the provider reported it (quote major units, exact decimal string). */
export interface FetchedQuote {
  readonly symbol: string;
  readonly currency: string;
  readonly price: string;
  readonly prevClose: string | null;
  /** When the data is from (not when it was fetched). */
  readonly asOf: Date;
}

/** Why a provider could not be used (FR-ST4 status), and until when to leave it alone. */
export interface AdapterFailure {
  readonly status: Extract<CredentialStatus, 'invalid_key' | 'quota_exhausted' | 'rate_limited' | 'error'>;
  /** The `Retry-After` header of a 429, as sent. */
  readonly retryAfter: string | null;
  /** When the provider said its quota resets. */
  readonly quotaResetAt: Date | null;
  /** Short machine code for the log (`http_401`, `cmc_1010`, `timeout`). */
  readonly code: string;
}

export interface AdapterResult {
  readonly quotes: FetchedQuote[];
  readonly calls: MarketCall[];
  /** Set when the key, the quota, or the provider failed; `quotes` holds what arrived before. */
  readonly failure: AdapterFailure | null;
  /** The provider accepts any key, so a success does not prove the key (Alpha Vantage). */
  readonly unverified: boolean;
  /** Credits the calls used, when the provider reports them (CoinMarketCap `status.credit_count`). */
  readonly credits: number | null;
}

export interface FetchQuotesInput {
  /** `null` for keyless sources. */
  readonly apiKey: string | null;
  readonly requests: readonly QuoteRequest[];
  readonly now: Date;
}

export interface MarketAdapter {
  readonly provider: MarketProvider;
  fetchQuotes(input: FetchQuotesInput): Promise<AdapterResult>;
  /** Optional licensed history: last actual session on or before the previous Dec 31. */
  fetchPriorClose?(input: FetchQuotesInput): Promise<AdapterResult>;
}

/** Collects the calls and quotes of one adapter run. */
export interface RunLog {
  readonly quotes: FetchedQuote[];
  readonly calls: MarketCall[];
  /** Records `response` for `endpoint` with `errorCode` (null when the call succeeded). */
  record(endpoint: string, response: MarketResponse, errorCode: string | null): void;
  result(failure: AdapterFailure | null, extra?: { unverified?: boolean; credits?: number | null }): AdapterResult;
}

export function runLog(provider: MarketProvider): RunLog {
  const quotes: FetchedQuote[] = [];
  const calls: MarketCall[] = [];
  return {
    quotes,
    calls,
    record(endpoint, response, errorCode) {
      calls.push({
        provider,
        endpoint,
        httpStatus: response.status,
        ok: errorCode === null,
        durationMs: response.durationMs,
        errorCode,
      });
    },
    result: (failure, extra = {}) => ({
      quotes,
      calls,
      failure,
      unverified: extra.unverified ?? false,
      credits: extra.credits ?? null,
    }),
  };
}

/**
 * The failure a non-2xx (or missing) response means, before any provider-specific body is read: no response →
 * `error` (`timeout`/`network`); 401/403 → `invalid_key`; 402 → `quota_exhausted`; 429 → `rate_limited` with its
 * `Retry-After`; anything else → `error`. `null` for a 2xx.
 */
export function httpFailure(response: MarketResponse): AdapterFailure | null {
  const { status } = response;
  if (status === null) {
    return { status: 'error', retryAfter: null, quotaResetAt: null, code: response.transportError ?? 'network' };
  }
  if (status >= 200 && status < 300) return null;
  const code = `http_${status}`;
  if (status === 401 || status === 403) return { status: 'invalid_key', retryAfter: null, quotaResetAt: null, code };
  if (status === 402) return { status: 'quota_exhausted', retryAfter: null, quotaResetAt: null, code };
  if (status === 429) {
    return { status: 'rate_limited', retryAfter: response.headers.get('retry-after'), quotaResetAt: null, code };
  }
  return { status: 'error', retryAfter: null, quotaResetAt: null, code };
}

/** 00:00 UTC of the day after `now` (daily quotas). */
export function nextUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/** 00:00 UTC of the first day of the month after `now` (monthly quotas). */
export function nextUtcMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

const DECIMAL_TEXT = /^\d{1,20}(?:\.\d+)?$/;

/**
 * A provider's number (JSON number or numeric string) as an exact positive decimal string with at most 18 fraction
 * digits; `null` for anything else (missing, `"NA"`, zero, negative, not finite, too large).
 */
export function decimalOf(value: unknown): string | null {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    text = /e/i.test(String(value)) ? value.toFixed(18) : String(value);
  } else if (typeof value === 'string') {
    text = value.trim();
  } else {
    return null;
  }
  if (!DECIMAL_TEXT.test(text)) return null;
  const [whole = '', fraction = ''] = text.split('.');
  const scaled = parseDecimal(fraction === '' ? whole : `${whole}.${fraction.slice(0, 18)}`);
  return scaled > 0n ? formatDecimal(scaled) : null;
}

/** `value` as a date from epoch seconds, epoch milliseconds, or an ISO string; `null` when unreadable. */
export function dateOf(value: unknown): Date | null {
  let date: Date;
  if (typeof value === 'number') date = new Date(value < 1e12 ? value * 1000 : value);
  else if (typeof value === 'string') date = new Date(value.includes('T') ? value : `${value}T00:00:00Z`);
  else return null;
  return Number.isNaN(date.getTime()) || date.getTime() <= 0 ? null : date;
}

/**
 * The previous close implied by a 24-hour change in percent (`price ÷ (1 + change/100)`), kept to 12 significant
 * digits so float noise does not pose as precision; `null` without a usable change.
 */
export function prevCloseFromChange(price: string, change: unknown): string | null {
  if (typeof change !== 'number' || !Number.isFinite(change) || change <= -100) return null;
  return decimalOf(Number((Number(price) / (1 + change / 100)).toPrecision(12)));
}

/** A plain object's own property, `undefined` for anything that is not an object. */
export function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}
