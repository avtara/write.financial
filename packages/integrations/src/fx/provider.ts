// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared shape of the built-in, keyless FX reference-rate adapters (D15, FR-T4, FR-ST1; research market-data §2.1):
 * every adapter returns normalized {@link FxRate}s and may only reach its own hosts (egress allowlist, plan §8 M5).
 */
import type { LocalDate } from '@wf/domain/period';
import type * as z from 'zod';

/** `bi_transaction`: Bank Indonesia's transaction (middle) rate via Frankfurter; `blended`: an aggregated mid rate. */
export type FxRateType = 'bi_transaction' | 'blended';

export type FxProviderName = 'frankfurter' | 'fawazahmed0' | 'open-er-api';

/** One reference rate: 1 `base` = `rate` `quote`, e.g. 1 USD = 17948.00000000 IDR. */
export interface FxRate {
  readonly base: string;
  readonly quote: string;
  /** Positive decimal with exactly 8 fraction digits, as stored in `fx_rates.rate numeric(20,8)`. */
  readonly rate: string;
  readonly provider: FxProviderName;
  readonly rateType: FxRateType;
  /** The day the source published the rate (not the day it was fetched). */
  readonly asOf: LocalDate;
}

/** Rates of every `bases` currency expressed in `quote` (ISO 4217, upper case, `quote` not among `bases`). */
export interface FxQuery {
  readonly quote: string;
  readonly bases: readonly string[];
}

export interface FxProvider {
  readonly name: FxProviderName;
  /** The only hosts this adapter may request. */
  readonly hosts: readonly string[];
  /**
   * Rates for the bases the source covers; uncovered bases are left out. Rejects with {@link FxProviderError} when
   * the source cannot be used at all (network, timeout, HTTP error, unexpected body).
   */
  fetchRates(query: FxQuery): Promise<FxRate[]>;
}

export interface FxProviderOptions {
  /** Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Per request; defaults to {@link FX_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

export const FX_TIMEOUT_MS = 10_000;

export class FxProviderError extends Error {
  override readonly name = 'FxProviderError';
  readonly provider: FxProviderName;

  constructor(provider: FxProviderName, message: string, options?: ErrorOptions) {
    super(`${provider}: ${message}`, options);
    this.provider = provider;
  }
}

/** Options of {@link getJson}, which answers `undefined` for a {@link GetJsonOptions.notFound} status. */
export interface GetJsonOptions<T> extends FxProviderOptions {
  readonly provider: FxProviderName;
  readonly hosts: readonly string[];
  readonly schema: z.ZodType<T>;
  /** Statuses that mean "this currency is not covered" rather than a failure. */
  readonly notFound?: readonly number[];
}

/**
 * GETs `url` and validates the JSON body against `schema`. Refuses any URL that is not HTTPS on one of `hosts`, and
 * refuses redirects, so a compromised or misconfigured source cannot send the worker elsewhere.
 */
export async function getJson<T>(url: string, options: GetJsonOptions<T> & { readonly notFound?: never }): Promise<T>;
export async function getJson<T>(url: string, options: GetJsonOptions<T>): Promise<T | undefined>;
export async function getJson<T>(url: string, options: GetJsonOptions<T>): Promise<T | undefined> {
  const { provider, hosts, schema, notFound = [], fetch: fetchFn = fetch, timeoutMs = FX_TIMEOUT_MS } = options;
  const target = new URL(url);
  if (target.protocol !== 'https:' || !hosts.includes(target.hostname)) {
    throw new FxProviderError(provider, `egress to ${target.origin} is not allowed`);
  }
  let response: Response;
  try {
    response = await fetchFn(target, {
      headers: { Accept: 'application/json', 'User-Agent': 'write.financial' },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new FxProviderError(provider, 'request failed', { cause: error });
  }
  if (notFound.includes(response.status)) return undefined;
  if (!response.ok) throw new FxProviderError(provider, `HTTP ${response.status}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new FxProviderError(provider, 'response is not JSON', { cause: error });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(body)'}: ${issue.message}`);
    throw new FxProviderError(provider, `unexpected response: ${issues.join('; ')}`);
  }
  return parsed.data;
}

const MAX_RATE = 1e12;

/**
 * `value` as an `fx_rates.rate` string (8 fraction digits), or `undefined` when it is not a usable rate: not
 * finite, zero or negative after rounding, or too large for `numeric(20,8)`.
 */
export function toRate(value: number): string | undefined {
  if (!Number.isFinite(value) || value >= MAX_RATE) return undefined;
  const rate = value.toFixed(8);
  return Number(rate) > 0 ? rate : undefined;
}
