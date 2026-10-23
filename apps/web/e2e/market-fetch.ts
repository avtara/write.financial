// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The E2E server's fake market data providers: preloaded into the production server (`node --import
 * ./e2e/market-fetch.ts`, see `playwright.config.ts`), it answers every request to a market data provider's host (the
 * egress allowlist of `@wf/domain/market`) itself, so E2E runs never reach a real API and need no real key. EODHD
 * answers synthetic closes for {@link FAKE_EODHD_KEY} (`BBCA.JK` 8.750, other symbols 1.000), explicit offline/429
 * scenarios, and 401 for any other token; every other provider answers 401. Non-market hosts use real `fetch`.
 */
import { EGRESS_ALLOWLIST } from '@wf/domain/market';

/** The made-up EODHD token the `market-api` project saves (obviously fake, never a real key). */
export const FAKE_EODHD_KEY = 'fake-e2e-eodhd-key';

const realFetch = globalThis.fetch;
const marketHosts = new Set(Object.values(EGRESS_ALLOWLIST).flat());
/** 14 Okt 2026, 16.15 WIB: a completed session before the run's morning clock. */
const CLOSE_AT = Date.parse('2026-10-14T09:15:00Z') / 1000;

function isMarketHost(host: string): boolean {
  for (const allowed of marketHosts) {
    if (allowed.startsWith('*.') ? host.endsWith(allowed.slice(1)) : host === allowed) return true;
  }
  return false;
}

function eodhd(url: URL): Response {
  const key = url.searchParams.get('api_token');
  if (key === 'fake-e2e-offline') throw new TypeError('Simulated market network failure');
  if (key === 'fake-e2e-rate-limit') {
    return Response.json({ message: 'Rate limit' }, { status: 429, headers: { 'Retry-After': '3600' } });
  }
  if (key !== FAKE_EODHD_KEY) {
    return Response.json({ message: 'Unauthenticated' }, { status: 401 });
  }
  if (url.pathname.startsWith('/api/eod/')) {
    return Response.json([{ date: '2025-12-30', close: 900 }]);
  }
  const first = decodeURIComponent(url.pathname.split('/').at(-1) ?? '');
  const symbols = [first, ...(url.searchParams.get('s')?.split(',') ?? [])];
  const rows = symbols.map((code) => {
    const close = code.toUpperCase() === 'BBCA.JK' ? 8750 : 1000;
    return { code, timestamp: CLOSE_AT, close, previousClose: close - 50 };
  });
  return Response.json(rows.length === 1 ? rows[0] : rows);
}

globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!isMarketHost(url.hostname)) return realFetch(input, init);
  if (url.hostname === 'eodhd.com') return Promise.resolve().then(() => eodhd(url));
  return Promise.resolve(Response.json({ error: 'Invalid API key' }, { status: 401 }));
};
