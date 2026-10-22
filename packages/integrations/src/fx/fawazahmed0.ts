// SPDX-License-Identifier: AGPL-3.0-only
/**
 * fawazahmed0/exchange-api (CC0, keyless, daily), the first FX fallback (research market-data §2.1): one file per
 * quote currency from jsDelivr, or from its Cloudflare Pages mirror when jsDelivr fails. The file lists how much of
 * each currency one unit of the quote buys (`idr.usd = 0.0000556…`, 8 significant digits), so each rate is the
 * inverse. The upstream data origin is undocumented, hence `blended`.
 */
import { parseLocalDate } from '@wf/domain/period';
import * as z from 'zod';
import { getJson, toRate, type FxProvider, type FxProviderOptions, type FxRate } from './provider.ts';

export const FAWAZAHMED0_URLS = [
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/',
  'https://latest.currency-api.pages.dev/v1/currencies/',
] as const;

/** Key the quote's table is moved to before validation; not a currency code, so it cannot collide. */
const TABLE = '$rates';

export function createFawazahmed0(options: FxProviderOptions = {}): FxProvider {
  const hosts = FAWAZAHMED0_URLS.map((url) => new URL(url).hostname);

  return {
    name: 'fawazahmed0',
    hosts,
    async fetchRates({ quote, bases }) {
      const key = quote.toLowerCase();
      // The table sits under the quote's own key (`{ date, idr: {…} }`); renamed so the schema has a static shape.
      const schema = z.preprocess(
        (body) =>
          typeof body === 'object' && body !== null
            ? { ...body, [TABLE]: (body as Record<string, unknown>)[key] }
            : body,
        z.object({ date: z.iso.date(), [TABLE]: z.record(z.string(), z.number()) }),
      );
      let failure: unknown;
      for (const url of FAWAZAHMED0_URLS) {
        try {
          // 404: no file for this quote currency.
          const file = await getJson(`${url}${key}.min.json`, {
            ...options,
            provider: 'fawazahmed0',
            schema,
            notFound: [404],
          });
          if (file === undefined) return [];
          const asOf = parseLocalDate(file.date);
          return bases.flatMap((base) => {
            const amount = file[TABLE][base.toLowerCase()];
            const rate = amount === undefined ? undefined : toRate(1 / amount);
            return rate === undefined
              ? []
              : [{ base, quote, rate, provider: 'fawazahmed0', rateType: 'blended', asOf } satisfies FxRate];
          });
        } catch (error) {
          failure = error;
        }
      }
      throw failure;
    },
  };
}
