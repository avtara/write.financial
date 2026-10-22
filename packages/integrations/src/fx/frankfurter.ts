// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Frankfurter (`api.frankfurter.dev/v2`), the primary FX source (FR-ST1: "kurs transaksi BI"): keyless, free for
 * commercial use, caching encouraged. Bases that Bank Indonesia publishes (provider `bi`, pivot IDR) are taken from
 * BI's transaction rate when the quote is IDR; every other base, or a base BI has no row for, uses Frankfurter's
 * blended rate. One request per base keeps full precision (a single `base=IDR` call answers `5.6e-05` for USD).
 */
import { parseLocalDate } from '@wf/domain/period';
import * as z from 'zod';
import { getJson, toRate, type FxProvider, type FxProviderOptions, type FxRate, type FxRateType } from './provider.ts';

export const FRANKFURTER_HOST = 'api.frankfurter.dev';

/**
 * How many units BI quotes each currency of Frankfurter's `bi` provider per (`GET /v2/providers/bi`, 2026-10-19):
 * BI's figure is divided by it. BI quotes JPY per 100 units and Frankfurter passes that through (11368.49 against a
 * blended 113.9 on 2026-10-16). A currency missing here is not published by BI.
 */
export const BI_UNITS: Readonly<Record<string, number>> = {
  AED: 1,
  AUD: 1,
  BND: 1,
  CAD: 1,
  CHF: 1,
  CNH: 1,
  CNY: 1,
  DKK: 1,
  EUR: 1,
  GBP: 1,
  HKD: 1,
  JPY: 100,
  KRW: 1,
  KWD: 1,
  LAK: 1,
  MYR: 1,
  NOK: 1,
  NZD: 1,
  PGK: 1,
  PHP: 1,
  SAR: 1,
  SEK: 1,
  SGD: 1,
  THB: 1,
  USD: 1,
  VND: 1,
};

const rows = z.array(
  z.object({
    date: z.iso.date(),
    base: z.string(),
    quote: z.string(),
    rate: z.number().positive(),
  }),
);

export function createFrankfurter(options: FxProviderOptions = {}): FxProvider {
  const hosts = [FRANKFURTER_HOST];

  async function fetchRate(path: string, query: { base: string; quote: string; rateType: FxRateType; units: number }) {
    const { base, quote, rateType, units } = query;
    const url = `https://${FRANKFURTER_HOST}/v2/${path}?${new URLSearchParams({ base, quotes: quote }).toString()}`;
    // 404/422: Frankfurter does not know the currency.
    const answer = await getJson(url, {
      ...options,
      provider: 'frankfurter',
      schema: rows,
      notFound: [404, 422],
    });
    const row = answer?.find((entry) => entry.base === base && entry.quote === quote);
    const rate = row === undefined ? undefined : toRate(row.rate / units);
    if (row === undefined || rate === undefined) return undefined;
    return { base, quote, rate, provider: 'frankfurter', rateType, asOf: parseLocalDate(row.date) } satisfies FxRate;
  }

  return {
    name: 'frankfurter',
    hosts,
    async fetchRates({ quote, bases }) {
      const rates: FxRate[] = [];
      // Sequential on purpose: all users share one server IP, and the source rate-limits abuse.
      for (const base of bases) {
        const units = quote === 'IDR' ? BI_UNITS[base] : undefined;
        const bi =
          units === undefined
            ? undefined
            : await fetchRate('providers/bi/rates', { base, quote, rateType: 'bi_transaction', units });
        const rate = bi ?? (await fetchRate('rates', { base, quote, rateType: 'blended', units: 1 }));
        if (rate !== undefined) rates.push(rate);
      }
      return rates;
    },
  };
}
