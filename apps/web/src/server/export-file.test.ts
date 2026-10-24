// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, fakeSession } from '../../test/fixtures.ts';
import { requestContext } from '../../test/server-fn.ts';
import { buildExport, serveDataExport } from './export-file.ts';

const fake = vi.hoisted(() => ({
  /** Set by the test that needs `services()` itself to fail (an outage, not an access refusal). */
  failServices: false,
  export: {
    collect: vi.fn(() =>
      Promise.resolve({
        exportedAt: NOW,
        truncated: [],
        user: { name: 'Avtara K.' },
        accounts: [{ id: 'a1', displayName: 'Bank' }],
      }),
    ),
    ledgerRows: vi.fn(() =>
      Promise.resolve([
        {
          id: 't1',
          occurredAt: new Date('2026-10-05T05:00:00Z'),
          type: 'expense',
          description: null,
          merchant: null,
          amountMinor: '-18000',
          currency: 'IDR',
          account: 'Bank',
          category: null,
          tags: null,
          deletedAt: null,
        },
      ]),
    ),
  },
}));

vi.mock('./runtime.ts', () => ({
  services: () =>
    fake.failServices
      ? Promise.reject(new Error('database unavailable'))
      : Promise.resolve({ now: () => NOW, export: fake.export }),
}));

const request = (search = '') => new Request(`https://uang.example/api/data/export${search}`);
const call = async (search = '', twoFactorEnabled = true, signedIn = true) =>
  serveDataExport({
    context: requestContext(signedIn ? fakeSession({ twoFactorEnabled }) : null),
    request: request(search),
  });

beforeEach(() => {
  vi.clearAllMocks();
  fake.failServices = false;
});

describe('serveDataExport', () => {
  it('serves the JSON export as a no-store attachment, never inline, never cached', async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="write-financial-export-2026-10-18.json"; filename*=UTF-8\'\'write-financial-export-2026-10-18.json',
    );
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(await response.text()).toContain('"accounts"');
    expect(fake.export.collect).toHaveBeenCalledWith(fakeSession().user.id);
  });

  it('serves the CSV of the ledger with ?format=csv', async () => {
    const response = await call('?format=csv');
    expect(response.headers.get('Content-Type')).toBe('text/csv');
    expect(response.headers.get('Content-Disposition')).toContain('write-financial-export-2026-10-18.csv');
    expect(await response.text()).toContain('id,occurred_at,type');
    expect(fake.export.ledgerRows).toHaveBeenCalledWith(fakeSession().user.id);
  });

  it('refuses signed-out requests with 401 and requests without 2FA with 403, as JSON without a file', async () => {
    const signedOut = await call('', false, false);
    expect(signedOut.status).toBe(401);
    expect(await signedOut.json()).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    const withoutTwoFactor = await call('', false);
    expect(withoutTwoFactor.status).toBe(403);
    expect(await withoutTwoFactor.json()).toEqual({ ok: false, code: 'TWO_FACTOR_REQUIRED' });
    expect(fake.export.collect).not.toHaveBeenCalled();
  });

  it('lets an outage (any failure that is not an access refusal) stay an error', async () => {
    fake.failServices = true;
    await expect(call()).rejects.toThrow('database unavailable');
  });
});

describe('buildExport', () => {
  it('serializes bigints as decimal strings and keeps the export date', async () => {
    const { json, csv, exportedAt } = await buildExport(fakeSession().user.id);
    expect(exportedAt).toEqual(NOW);
    expect(json).toContain('"displayName": "Bank"');
    expect(csv).toContain('-18000');
  });
});
