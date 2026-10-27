// SPDX-License-Identifier: AGPL-3.0-only
import type { EmailLogView, GmailRepository } from '@wf/db/gmail';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, fakeSession } from '../../test/fixtures.ts';
import { requestContext } from '../../test/server-fn.ts';
import { serveGmailLog } from './gmail-log-file.ts';

const fake = vi.hoisted(() => ({
  failServices: false,
  gmail: { listLogs: vi.fn<GmailRepository['listLogs']>() },
}));

vi.mock('./runtime.ts', () => ({
  services: () =>
    fake.failServices
      ? Promise.reject(new Error('database unavailable'))
      : Promise.resolve({
          now: () => NOW,
          gmail: fake.gmail,
        }),
}));

const call = async (twoFactorEnabled = true, signedIn = true) =>
  serveGmailLog({ context: requestContext(signedIn ? fakeSession({ twoFactorEnabled }) : null) });

const sample: EmailLogView = {
  id: 'log-1',
  messageId: 'msg-1',
  fromAddr: 'cs@bca.co.id',
  subject: 'Transaksi Rp 350.000',
  filterResult: 'passed',
  outcome: 'pending',
  confidence: 97,
  processing: 'done',
  extraction: null,
  errorCode: null,
  receivedAt: new Date('2026-10-17T18:02:00Z'),
  createdAt: NOW,
  reviewItemId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  fake.failServices = false;
  fake.gmail.listLogs.mockResolvedValue([sample]);
});

describe('serveGmailLog', () => {
  it('serves the log as a no-store CSV attachment with the hardened headers', async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/csv');
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="write-financial-gmail-log-2026-10-18.csv"; filename*=UTF-8\'\'write-financial-gmail-log-2026-10-18.csv',
    );
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(await response.text()).toBe(
      'waktu,pengirim,subjek,filter,ai,status,extraction,processing,error\r\n2026-10-17T18:02:00.000Z,cs@bca.co.id,Transaksi Rp 350.000,passed,97,pending,,done,',
    );
  });

  it('streams all retained rows in bounded keyset pages, not just the settings preview', async () => {
    const first = Array.from({ length: 500 }, (_, index) => ({ ...sample, id: `log-${index}` }));
    fake.gmail.listLogs
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce([{ ...sample, id: 'last-log', subject: 'last page' }]);
    const response = await call();
    const csv = await response.text();
    expect(csv).toContain('last page');
    expect(fake.gmail.listLogs).toHaveBeenNthCalledWith(1, fakeSession().user.id, { limit: 500 });
    expect(fake.gmail.listLogs).toHaveBeenNthCalledWith(2, fakeSession().user.id, {
      limit: 500,
      before: { at: NOW, id: 'log-499' },
    });
  });

  it('refuses signed-out requests with 401 and requests without 2FA with 403, as JSON without a file', async () => {
    const signedOut = await call(true, false);
    expect(signedOut.status).toBe(401);
    expect(await signedOut.json()).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    const withoutTwoFactor = await call(false);
    expect(withoutTwoFactor.status).toBe(403);
    expect(await withoutTwoFactor.json()).toEqual({ ok: false, code: 'TWO_FACTOR_REQUIRED' });
    expect(fake.gmail.listLogs).not.toHaveBeenCalled();
  });

  it('lets an outage (any failure that is not an access refusal) stay an error', async () => {
    fake.failServices = true;
    await expect(call()).rejects.toThrow('database unavailable');
  });
});
