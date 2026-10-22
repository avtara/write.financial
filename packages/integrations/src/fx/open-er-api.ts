// SPDX-License-Identifier: AGPL-3.0-only
/**
 * open.er-api.com (ExchangeRate-API Open Access), the last FX fallback (research market-data §2.1): keyless, updated
 * once a day, rate-limited per IP (429 for 20 minutes), so it is asked at most once per run. Using it requires the
 * attribution "Rates By Exchange Rate API" wherever its rates are shown (`provider: 'open-er-api'`). Its IDR table has
 * only 2 significant digits (`USD: 5.5e-5`), so rates are crossed through the USD table: `base→quote = USD→quote ÷
 * USD→base`.
 */
import { parseLocalDate } from '@wf/domain/period';
import * as z from 'zod';
import { getJson, toRate, type FxProvider, type FxProviderOptions, type FxRate } from './provider.ts';

export const OPEN_ER_API_URL = 'https://open.er-api.com/v6/latest/USD';

const latest = z.object({
  result: z.literal('success'),
  time_last_update_unix: z.number().int().positive(),
  base_code: z.literal('USD'),
  rates: z.record(z.string(), z.number()),
});

export function createOpenErApi(options: FxProviderOptions = {}): FxProvider {
  const hosts = [new URL(OPEN_ER_API_URL).hostname];

  return {
    name: 'open-er-api',
    hosts,
    async fetchRates({ quote, bases }) {
      const answer = await getJson(OPEN_ER_API_URL, { ...options, provider: 'open-er-api', schema: latest });
      // The table is published at 00:00 UTC for that UTC day.
      const asOf = parseLocalDate(new Date(answer.time_last_update_unix * 1000).toISOString().slice(0, 10));
      const { rates } = answer;
      const perQuote = rates[quote];
      if (perQuote === undefined) return [];
      return bases.flatMap((base) => {
        const perBase = rates[base];
        const rate = perBase === undefined ? undefined : toRate(perQuote / perBase);
        return rate === undefined
          ? []
          : [{ base, quote, rate, provider: 'open-er-api', rateType: 'blended', asOf } satisfies FxRate];
      });
    },
  };
}
