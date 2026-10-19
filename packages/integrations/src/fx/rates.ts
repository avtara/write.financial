// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Built-in FX reference rates (D15, FR-T4, FR-ST1): Frankfurter first, then fawazahmed0, then open.er-api (research
 * market-data §2.1, plan §6 `fx`). Each source is asked only for the bases the previous ones did not answer, so a
 * currency Frankfurter lacks still gets a rate, and a source outage costs nothing as long as a later one answers.
 * Bases no source answers keep their last stored rate (FR-T4: "use the last rate").
 */
import { createFawazahmed0 } from './fawazahmed0.ts';
import { createFrankfurter } from './frankfurter.ts';
import { createOpenErApi } from './open-er-api.ts';
import type { FxProvider, FxProviderName, FxProviderOptions, FxRate } from './provider.ts';

/** Bases always fetched, whether or not an account uses them yet (onboarding and the transfer sheet offer them). */
export const DEFAULT_FX_BASES = ['USD', 'SGD', 'EUR', 'JPY', 'AUD', 'MYR', 'CNY', 'GBP'] as const;

const CURRENCY_CODE = /^[A-Z]{3}$/;

/** The built-in sources in fallback order. */
export function createBuiltInFxProviders(options: FxProviderOptions = {}): FxProvider[] {
  return [createFrankfurter(options), createFawazahmed0(options), createOpenErApi(options)];
}

export interface FxFetchResult {
  readonly rates: FxRate[];
  /** Bases no source answered, sorted. */
  readonly missing: string[];
  /**
   * Sources that failed outright, as `String(error)` (`FxProviderError: frankfurter: HTTP 503`); never user data, since
   * requests carry currency codes only.
   */
  readonly failures: { readonly provider: FxProviderName; readonly error: string }[];
}

/** Thrown for a query with a code that is not three upper-case letters (it would end up in request URLs). */
export class InvalidCurrencyError extends Error {
  override readonly name = 'InvalidCurrencyError';

  constructor(code: string) {
    super(`Invalid currency code: ${JSON.stringify(code)}`);
  }
}

/**
 * Rates of every distinct `bases` currency (the quote itself left out) in `quote`, each from the first source in
 * `providers` that answers it.
 */
export async function fetchReferenceRates(
  providers: readonly FxProvider[],
  query: { readonly quote: string; readonly bases: Iterable<string> },
): Promise<FxFetchResult> {
  const { quote } = query;
  for (const code of [quote, ...query.bases]) if (!CURRENCY_CODE.test(code)) throw new InvalidCurrencyError(code);
  let remaining = [...new Set(query.bases)].filter((base) => base !== quote).sort();
  const rates: FxRate[] = [];
  const failures: FxFetchResult['failures'] = [];
  for (const provider of providers) {
    if (remaining.length === 0) break;
    try {
      const answered = (await provider.fetchRates({ quote, bases: remaining })).filter((rate) =>
        remaining.includes(rate.base),
      );
      rates.push(...answered);
      remaining = remaining.filter((base) => !answered.some((rate) => rate.base === base));
    } catch (error) {
      failures.push({ provider: provider.name, error: String(error) });
    }
  }
  return { rates, missing: remaining, failures };
}
