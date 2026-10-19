// SPDX-License-Identifier: AGPL-3.0-only
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BI_UNITS, createFrankfurter, FRANKFURTER_HOST } from './frankfurter.ts';

const API = `https://${FRANKFURTER_HOST}/v2`;

/** Recorded on 2026-10-19 (BI's latest day was Friday 2026-10-16). */
const BI: Record<string, number> = { USD: 17948.0, JPY: 11368.49, SGD: 13999.12 };
const BLENDED: Record<string, number> = { USD: 18004, JPY: 113.9, ISK: 146.37, SGD: 14068 };

const requests: string[] = [];
const server = setupServer(
  http.get(`${API}/providers/bi/rates`, ({ request }) => {
    const url = new URL(request.url);
    requests.push(`bi ${url.search}`);
    const base = url.searchParams.get('base') ?? '';
    const rate = BI[base];
    return HttpResponse.json(rate === undefined ? [] : [{ date: '2026-10-16', base, quote: 'IDR', rate }]);
  }),
  http.get(`${API}/rates`, ({ request }) => {
    const url = new URL(request.url);
    requests.push(`blended ${url.search}`);
    const base = url.searchParams.get('base') ?? '';
    const quote = url.searchParams.get('quotes') ?? '';
    if (base === 'XTS') return HttpResponse.json({ status: 422, message: 'invalid currency: XTS' }, { status: 422 });
    const rate = quote === 'IDR' ? BLENDED[base] : 0.88;
    return HttpResponse.json(rate === undefined ? [] : [{ date: '2026-10-19', base, quote, rate }]);
  }),
);

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterEach(() => {
  server.resetHandlers();
  requests.length = 0;
});
afterAll(() => {
  server.close();
});

describe('createFrankfurter', () => {
  const frankfurter = createFrankfurter();

  it('only reaches its own host', () => {
    expect(frankfurter).toMatchObject({ name: 'frankfurter', hosts: ['api.frankfurter.dev'] });
  });

  it("takes BI's transaction rate for BI currencies, per unit, and the blended rate for the rest", async () => {
    const rates = await frankfurter.fetchRates({ quote: 'IDR', bases: ['USD', 'JPY', 'ISK'] });
    expect(rates).toEqual([
      {
        base: 'USD',
        quote: 'IDR',
        rate: '17948.00000000',
        provider: 'frankfurter',
        rateType: 'bi_transaction',
        asOf: '2026-10-16',
      },
      {
        base: 'JPY',
        quote: 'IDR',
        rate: '113.68490000',
        provider: 'frankfurter',
        rateType: 'bi_transaction',
        asOf: '2026-10-16',
      },
      {
        base: 'ISK',
        quote: 'IDR',
        rate: '146.37000000',
        provider: 'frankfurter',
        rateType: 'blended',
        asOf: '2026-10-19',
      },
    ]);
    expect(requests).toEqual(['bi ?base=USD&quotes=IDR', 'bi ?base=JPY&quotes=IDR', 'blended ?base=ISK&quotes=IDR']);
    expect(BI_UNITS['JPY']).toBe(100);
  });

  it('falls back to the blended rate when BI has no row for a BI currency', async () => {
    const rates = await frankfurter.fetchRates({ quote: 'IDR', bases: ['MYR', 'SGD'] });
    // MYR: BI answers [], blended answers [] too → left out. SGD: BI row.
    expect(rates.map((rate) => [rate.base, rate.rateType])).toEqual([['SGD', 'bi_transaction']]);
    expect(requests).toEqual(['bi ?base=MYR&quotes=IDR', 'blended ?base=MYR&quotes=IDR', 'bi ?base=SGD&quotes=IDR']);
  });

  it('uses only blended rates for a quote other than IDR', async () => {
    const rates = await frankfurter.fetchRates({ quote: 'EUR', bases: ['USD'] });
    expect(rates).toEqual([
      {
        base: 'USD',
        quote: 'EUR',
        rate: '0.88000000',
        provider: 'frankfurter',
        rateType: 'blended',
        asOf: '2026-10-19',
      },
    ]);
    expect(requests).toEqual(['blended ?base=USD&quotes=EUR']);
  });

  it('leaves out unknown currencies, rows for another pair, and unusable rates', async () => {
    server.use(
      http.get(`${API}/rates`, ({ request }) => {
        const base = new URL(request.url).searchParams.get('base');
        if (base === 'XTS') return HttpResponse.json({ status: 422 }, { status: 422 });
        if (base === 'XAG') return HttpResponse.json({ status: 404 }, { status: 404 });
        if (base === 'ISK') return HttpResponse.json([{ date: '2026-10-19', base: 'EUR', quote: 'IDR', rate: 1 }]);
        return HttpResponse.json([{ date: '2026-10-19', base, quote: 'IDR', rate: 1e13 }]);
      }),
    );
    expect(await frankfurter.fetchRates({ quote: 'IDR', bases: ['XTS', 'XAG', 'ISK', 'BTC'] })).toEqual([]);
  });

  it('rejects when the API fails', async () => {
    server.use(http.get(`${API}/providers/bi/rates`, () => new HttpResponse(null, { status: 503 })));
    await expect(frankfurter.fetchRates({ quote: 'IDR', bases: ['USD'] })).rejects.toThrow('frankfurter: HTTP 503');
    server.use(
      http.get(`${API}/rates`, () => HttpResponse.json([{ date: '19-10-2026', base: 'ISK', quote: 'IDR', rate: 1 }])),
    );
    await expect(frankfurter.fetchRates({ quote: 'IDR', bases: ['ISK'] })).rejects.toThrow(
      /^frankfurter: unexpected response: 0\.date: /,
    );
  });
});
