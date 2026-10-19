// SPDX-License-Identifier: AGPL-3.0-only
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createFawazahmed0, FAWAZAHMED0_URLS } from './fawazahmed0.ts';

const [JSDELIVR, PAGES] = FAWAZAHMED0_URLS;

/** Recorded on 2026-10-19 (shortened). */
const IDR = { date: '2026-10-18', idr: { usd: 0.000055555, jpy: 0.0087815, eur: 0.000049432, xyz: 0, neg: -1 } };

const requests: string[] = [];
const server = setupServer(
  http.get(`${JSDELIVR}:file`, ({ params }) => {
    requests.push(`jsdelivr ${String(params['file'])}`);
    return params['file'] === 'idr.min.json' ? HttpResponse.json(IDR) : new HttpResponse(null, { status: 404 });
  }),
  http.get(`${PAGES}:file`, ({ params }) => {
    requests.push(`pages ${String(params['file'])}`);
    return HttpResponse.json({ ...IDR, date: '2026-10-19' });
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

describe('createFawazahmed0', () => {
  const fawazahmed0 = createFawazahmed0();

  it('only reaches jsDelivr and its Cloudflare Pages mirror', () => {
    expect(fawazahmed0).toMatchObject({
      name: 'fawazahmed0',
      hosts: ['cdn.jsdelivr.net', 'latest.currency-api.pages.dev'],
    });
  });

  it('inverts the quote file and leaves out missing or unusable entries', async () => {
    const rates = await fawazahmed0.fetchRates({ quote: 'IDR', bases: ['USD', 'JPY', 'GBP', 'XYZ', 'NEG'] });
    expect(rates).toEqual([
      {
        base: 'USD',
        quote: 'IDR',
        rate: '18000.18000180',
        provider: 'fawazahmed0',
        rateType: 'blended',
        asOf: '2026-10-18',
      },
      {
        base: 'JPY',
        quote: 'IDR',
        rate: '113.87576154',
        provider: 'fawazahmed0',
        rateType: 'blended',
        asOf: '2026-10-18',
      },
    ]);
    expect(requests).toEqual(['jsdelivr idr.min.json']);
  });

  it('answers nothing when there is no file for the quote', async () => {
    expect(await fawazahmed0.fetchRates({ quote: 'XTS', bases: ['USD'] })).toEqual([]);
    expect(requests).toEqual(['jsdelivr xts.min.json']);
  });

  it('uses the mirror when jsDelivr fails', async () => {
    server.use(http.get(`${JSDELIVR}:file`, () => new HttpResponse(null, { status: 503 })));
    const rates = await fawazahmed0.fetchRates({ quote: 'IDR', bases: ['EUR'] });
    expect(rates).toEqual([
      {
        base: 'EUR',
        quote: 'IDR',
        rate: '20229.81064897',
        provider: 'fawazahmed0',
        rateType: 'blended',
        asOf: '2026-10-19',
      },
    ]);
    expect(requests).toEqual(['pages idr.min.json']);
  });

  it('rejects with the last error when both hosts fail', async () => {
    server.use(
      http.get(`${JSDELIVR}:file`, () => HttpResponse.json('maintenance')),
      http.get(`${PAGES}:file`, () => HttpResponse.json({ date: '2026-10-19', usd: {} })),
    );
    await expect(fawazahmed0.fetchRates({ quote: 'IDR', bases: ['USD'] })).rejects.toThrow(
      /^fawazahmed0: unexpected response: \$rates: /,
    );
    server.use(http.get(`${PAGES}:file`, () => HttpResponse.json('maintenance')));
    await expect(fawazahmed0.fetchRates({ quote: 'IDR', bases: ['USD'] })).rejects.toThrow(
      /^fawazahmed0: unexpected response: \(body\): /,
    );
  });
});
