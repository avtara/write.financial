// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession, NOW } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import { GmailRevokedError } from '@wf/integrations/gmail';
import { LedgerError } from '@wf/db/ledger-errors';
import type { Result } from '../access.ts';
import type { EmailLogView } from '@wf/db/gmail';
import {
  disconnectGmail,
  gmailLogCsv,
  getGmailSettings,
  localMonth,
  startGmailConnect,
  testFilters,
  updateFilters,
  type GmailSettings,
} from './gmail.ts';
const fake = vi.hoisted(() => ({
  config: {
    publicUrl: 'https://money.test/',
    google: null as { clientId: string; clientSecret: string; gmail: object } | null,
  },
  gmail: {
    getConnection: vi.fn(),
    monthlyStats: vi.fn(),
    listLogs: vi.fn(),
    updateFilters: vi.fn(),
    markRevoked: vi.fn(),
    tokens: vi.fn(),
    createConsent: vi.fn(),
    assertCurrent: vi.fn(),
    rotateTokens: vi.fn(),
  },
  gmailFetch: { listMessages: vi.fn(), revoke: vi.fn() },
}));
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({ services: () => Promise.resolve({ ...fake, now: () => NOW }) }));
const filters = { senders: ['bank.test'], keywords: ['paid'], ignoreKeywords: ['promo'] };
const userId = fakeSession().user.id;
const connection = {
  email: 'fixture@gmail.com',
  grantId: 'fixture-grant',
  status: 'connected',
  filters,
  historyId: '501',
  createdAt: NOW,
  updatedAt: NOW,
  watchRenewedAt: NOW,
  watchExpiresAt: NOW,
};
const context = () => requestContext(fakeSession());
const row = (overrides: Partial<EmailLogView> = {}): EmailLogView => ({
  id: 'log',
  messageId: 'mail',
  fromAddr: 'pay@bank.test',
  subject: 'PLN payment',
  filterResult: 'passed',
  outcome: 'pending',
  processing: 'done',
  errorCode: null,
  extraction: null,
  confidence: 97,
  receivedAt: NOW,
  createdAt: NOW,
  reviewItemId: 'review',
  ...overrides,
});
beforeEach(() => {
  vi.resetAllMocks();
  fake.config.google = {
    clientId: 'fixture-client',
    clientSecret: 'fixture-secret',
    gmail: { cloudProject: 'fixture', pubsubTopic: 'projects/fixture/topics/mail' },
  };
  fake.gmail.getConnection.mockResolvedValue(connection);
  fake.gmail.tokens.mockResolvedValue({
    accessToken: 'private-access',
    refreshToken: 'private-refresh',
    expiresAt: NOW,
  });
  fake.gmail.monthlyStats.mockResolvedValue({
    received: 1,
    passed: 1,
    pending: 1,
    confirmed: 0,
    ignored: 0,
    duplicate: 0,
    filtered: 0,
  });
  fake.gmail.listLogs.mockResolvedValue([row()]);
  fake.gmail.markRevoked.mockResolvedValue({ ...connection, status: 'revoked' });
  fake.gmailFetch.revoke.mockResolvedValue(undefined);
});

describe('separate Gmail consent guard', () => {
  it('requires explicit consent, a signed-in current 2FA user and a <=15 minute session', async () => {
    expect(validatorOf(startGmailConnect).safeParse({}).success).toBe(false);
    expect(validatorOf(startGmailConnect).safeParse({ consent: false }).success).toBe(false);
    for (const [session, code] of [
      [null, 'UNAUTHENTICATED'],
      [fakeSession({ twoFactorEnabled: false }), 'TWO_FACTOR_REQUIRED'],
      [fakeSession({ ageMinutes: 16 }), 'REAUTHENTICATION_REQUIRED'],
    ] as const) {
      expect(await call(startGmailConnect, { context: requestContext(session), data: { consent: true } })).toEqual({
        ok: false,
        code,
      });
    }
    expect(fake.gmail.createConsent).not.toHaveBeenCalled();
  });
  it('starts a real fixed redirect with unguessable state and only Gmail readonly, without exposing stored tokens', async () => {
    const result = await call<Result<{ url: string }>>(startGmailConnect, {
      context: context(),
      data: { consent: true },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Unexpected refusal');
    const url = new URL(result.value.url);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/gmail.readonly');
    expect(url.searchParams.get('redirect_uri')).toBe('https://money.test/api/gmail/callback');
    expect(url.searchParams.get('state')).toMatch(/^[a-f0-9]{64}$/);
    expect(fake.gmail.createConsent).toHaveBeenCalledWith(
      userId,
      url.searchParams.get('state'),
      fakeSession().session.id,
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(JSON.stringify(result)).not.toContain('private-access');
    expect(JSON.stringify(result)).not.toContain('fixture-secret');
    fake.config.google = null;
    expect(await call(startGmailConnect, { context: context(), data: { consent: true } })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
  });
});

describe('dry-run and disconnect boundaries', () => {
  it('tests the latest five against UNSAVED filters, without extraction or email/review persistence', async () => {
    const unsaved = { ...filters, ignoreKeywords: ['PLN'] };
    fake.gmailFetch.listMessages.mockImplementation(
      async (
        _tokens,
        _history,
        options: { assertCurrent(): Promise<void>; onRefresh(tokens: object): Promise<void> },
      ) => {
        await options.assertCurrent();
        await options.onRefresh({ accessToken: 'rotated-private' });
        return { messages: [{ from: 'pay@bank.test', subject: 'Paid', excerpt: 'PLN', receivedAt: NOW }] };
      },
    );
    expect(await call(testFilters, { context: context(), data: unsaved })).toEqual({
      ok: true,
      value: [{ fromAddr: 'pay@bank.test', subject: 'Paid', verdict: 'ignored_keyword' }],
    });
    expect(fake.gmailFetch.listMessages).toHaveBeenCalledWith(
      expect.any(Object),
      null,
      expect.objectContaining({ latest: 5 }),
    );
    expect(fake.gmail.assertCurrent).toHaveBeenCalledWith(userId, connection.grantId);
    expect(fake.gmail.rotateTokens).toHaveBeenCalledWith(userId, connection.grantId, {
      accessToken: 'rotated-private',
    });
    expect(fake.gmail.listLogs).not.toHaveBeenCalled();
    expect(fake.gmail.updateFilters).not.toHaveBeenCalled();
  });
  it('refuses disabled or revoked egress and destroys credentials when Google revokes the grant', async () => {
    fake.config.google = null;
    expect(await call(testFilters, { context: context(), data: filters })).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(fake.gmailFetch.listMessages).not.toHaveBeenCalled();
    fake.config.google = { clientId: 'c', clientSecret: 's', gmail: {} };
    fake.gmailFetch.listMessages.mockRejectedValue(new GmailRevokedError('revoked'));
    expect(await call(testFilters, { context: context(), data: filters })).toEqual({
      ok: false,
      code: 'GMAIL_REVOKED',
    });
    expect(fake.gmail.markRevoked).toHaveBeenCalledWith(userId, connection.grantId);
    fake.gmail.getConnection.mockResolvedValue({ ...connection, status: 'revoked' });
    fake.gmailFetch.listMessages.mockClear();
    expect(await call(testFilters, { context: context(), data: filters })).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(fake.gmailFetch.listMessages).not.toHaveBeenCalled();
  });
  it('commits a local tombstone before remote revocation, even if Google is unavailable', async () => {
    fake.gmailFetch.revoke.mockImplementation(() => {
      expect(fake.gmail.markRevoked).toHaveBeenCalledWith(userId, connection.grantId);
      return Promise.reject(new Error('remote unavailable'));
    });
    expect(await call(disconnectGmail, { context: context(), data: {} })).toMatchObject({
      ok: true,
      value: { status: 'revoked' },
    });
    expect(fake.gmailFetch.revoke).toHaveBeenCalledTimes(1);
  });
  it('still tombstones locally without remote revocation when no tokens remain or Gmail is disabled', async () => {
    fake.gmail.tokens.mockResolvedValueOnce(null);
    expect(await call(disconnectGmail, { context: context(), data: {} })).toMatchObject({
      ok: true,
      value: { status: 'revoked' },
    });
    fake.config.google = null;
    expect(await call(disconnectGmail, { context: context(), data: {} })).toMatchObject({
      ok: true,
      value: { status: 'revoked' },
    });
    expect(fake.gmail.markRevoked).toHaveBeenCalledTimes(2);
    expect(fake.gmailFetch.revoke).not.toHaveBeenCalled();
  });
  it('keeps every function tenant-derived and refuses signed-out access before repositories/egress', async () => {
    for (const [fn, data] of [
      [getGmailSettings, {}],
      [updateFilters, filters],
      [testFilters, filters],
      [disconnectGmail, {}],
    ] as const)
      expect(await call(fn, { context: requestContext(null), data })).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    expect(fake.gmail.getConnection).not.toHaveBeenCalled();
    expect(fake.gmailFetch.listMessages).not.toHaveBeenCalled();
  });

  it('refuses filter changes and disconnects for missing connections rather than manufacturing a connection', async () => {
    fake.gmail.updateFilters.mockRejectedValueOnce(new LedgerError('NOT_FOUND'));
    expect(await call(updateFilters, { context: context(), data: filters })).toEqual({ ok: false, code: 'NOT_FOUND' });
    fake.gmail.getConnection.mockResolvedValue(null);
    expect(await call(disconnectGmail, { context: context(), data: {} })).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(fake.gmail.markRevoked).not.toHaveBeenCalled();
  });

  it('refuses a token deletion race and propagates unrelated provider outages without revoking the saved grant', async () => {
    fake.gmail.tokens.mockResolvedValueOnce(null);
    expect(await call(testFilters, { context: context(), data: filters })).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(fake.gmailFetch.listMessages).not.toHaveBeenCalled();
    fake.gmailFetch.listMessages.mockRejectedValueOnce(new Error('Gmail unavailable'));
    await expect(call(testFilters, { context: context(), data: filters })).rejects.toThrow('Gmail unavailable');
    expect(fake.gmail.markRevoked).not.toHaveBeenCalled();
  });
});

describe('local-month log and safe CSV', () => {
  it('uses the user local half-open month and returns bounded evidence, not credential blobs', async () => {
    const result = await call<Result<GmailSettings>>(getGmailSettings, { context: context(), data: {} });
    expect(result.ok && result.value.configured).toBe(true);
    expect(fake.gmail.monthlyStats).toHaveBeenCalledWith(userId, {
      from: new Date('2026-09-30T17:00:00Z'),
      to: new Date('2026-10-31T17:00:00Z'),
    });
    expect(JSON.stringify(result)).not.toContain('private-access');
    expect(localMonth(new Date('2026-12-05'), 'Asia/Jakarta')).toEqual({
      from: new Date('2026-11-30T17:00:00Z'),
      to: new Date('2026-12-31T17:00:00Z'),
    });
    expect(localMonth(new Date('2026-11-01T00:30:00Z'), 'America/New_York').from).toEqual(
      new Date('2026-10-01T04:00:00Z'),
    );
  });

  it('uses the documented Jakarta month for an older session without a timezone', async () => {
    const session = fakeSession();
    delete session.user.timezone;
    await call(getGmailSettings, { context: requestContext(session), data: {} });
    expect(fake.gmail.monthlyStats).toHaveBeenCalledWith(userId, {
      from: new Date('2026-09-30T17:00:00Z'),
      to: new Date('2026-10-31T17:00:00Z'),
    });
  });
  it('exports extracted values and per-field confidence while quoting RFC4180 and neutralizing spreadsheet formulas', () => {
    const csv = gmailLogCsv([
      row({
        subject: '=HYPERLINK("evil")',
        fromAddr: '+cmd',
        extraction: {
          amountMinor: 350000n,
          occurredAt: NOW,
          merchant: 'PLN, shop',
          accountId: null,
          categoryId: null,
          currency: 'IDR',
          confidence: { amount: 97, date: 95, merchant: 90, currency: 97, account: 0, category: 0 },
        },
      }),
      row({ subject: 'line\nbreak', confidence: null }),
    ]);
    expect(csv).toContain("'+cmd");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain('350000');
    expect(csv).toContain('""amount"":97');
    expect(csv).toContain('"line\nbreak"');
    expect(csv).not.toContain('private-refresh');
  });
});
