// SPDX-License-Identifier: AGPL-3.0-only
import { generateKeyPairSync, sign } from 'node:crypto';
import { generateDek } from '@wf/crypto/envelope';
import { createGmail, type GmailRepository } from '@wf/db/gmail';
import { PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '@wf/db/testing';
import { createGmailClient, GMAIL_SCOPE } from '@wf/integrations/gmail';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession, NOW } from '../../test/fixtures.ts';
import { requestContext } from '../../test/server-fn.ts';
import { gmailCallback, gmailPush } from './gmail-webhooks.ts';
const runtime = vi.hoisted((): { value: Record<string, unknown> } => ({ value: {} }));
vi.mock('./runtime.ts', () => ({ services: () => Promise.resolve(runtime.value) }));
let test: TestDatabase;
let gmail: GmailRepository;
let clock = NOW;
const dek = generateDek();
const userId = fakeSession().user.id;
const googleFetch = vi.fn<typeof fetch>();
const enqueue = vi.fn();
const config = {
  publicUrl: 'https://money.test/',
  google: {
    clientId: 'client',
    clientSecret: 'secret',
    gmail: {
      cloudProject: 'fixture',
      pubsubTopic: 'projects/fixture/topics/mail',
      pushServiceAccount: 'push@fixture.iam.gserviceaccount.com',
    },
  },
};
const state = 'a'.repeat(64);
const context = () => requestContext(fakeSession());
const callback = (query: string, ctx = context()) =>
  test.as('wf_app', () =>
    gmailCallback({ context: ctx, request: new Request(`https://money.test/api/gmail/callback?${query}`) }),
  );
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwt = (overrides: Record<string, unknown> = {}) => {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture' })).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({
      iss: 'https://accounts.google.com',
      aud: 'https://money.test/api/gmail/push',
      email: config.google.gmail.pushServiceAccount,
      email_verified: true,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...overrides,
    }),
  ).toString('base64url');
  return `${header}.${claims}.${sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), privateKey).toString('base64url')}`;
};
const push = (token = jwt(), mail = 'fixture@gmail.com') =>
  test.as('wf_app', () =>
    gmailPush({
      request: new Request('https://money.test/api/gmail/push', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          subscription: 'projects/fixture/subscriptions/mail',
          message: {
            messageId: '123',
            data: Buffer.from(JSON.stringify({ emailAddress: mail, historyId: '501' })).toString('base64url'),
          },
        }),
      }),
    }),
  );
beforeAll(async () => {
  test = await startMigrated();
  await test.query(
    "INSERT INTO users(id,name,email,two_factor_enabled) VALUES ($1,'Gmail callback','gmail-callback@example.test',true)",
    [userId],
  );
  gmail = createGmail(test.db, { getDek: () => Promise.resolve(dek), now: () => clock });
}, PGLITE_HOOK_TIMEOUT);
afterAll(async () => {
  await test.close();
});
beforeEach(async () => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  clock = NOW;
  await test.query('DELETE FROM gmail_connections');
  await test.query('DELETE FROM gmail_oauth_states');
  runtime.value = {
    config,
    gmail,
    gmailFetch: createGmailClient({ oauth: config.google, fetch: googleFetch }),
    gmailQueue: { enqueue },
    now: () => clock,
  };
  googleFetch.mockImplementation((input) =>
    Promise.resolve(
      (input instanceof Request ? input.url : input.toString()).endsWith('/token')
        ? Response.json({
            access_token: 'private-access',
            refresh_token: 'private-refresh',
            expires_in: 3600,
            scope: GMAIL_SCOPE,
          })
        : Response.json({ emailAddress: 'fixture@gmail.com', historyId: '501' }),
    ),
  );
  enqueue.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
    expect(input instanceof Request ? input.url : input.toString()).toBe('https://www.googleapis.com/oauth2/v3/certs');
    return Promise.resolve(
      Response.json({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'RS256' }] }),
    );
  });
});

describe('separate OAuth callback', () => {
  it('exchanges the code only after one-use session-bound consent, stores encrypted credentials and enqueues IDs', async () => {
    await test.as('wf_app', () => gmail.createConsent(userId, state, fakeSession().session.id, 'verifier'));
    const response = await callback(`state=${state}&code=private-code&redirect=https://evil.test`);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://money.test/?settings=gmail#gmail-connected');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(await response.text()).toBe('');
    expect(enqueue).toHaveBeenCalledWith(userId, expect.stringMatching(/^connect/));
    const connection = await test.as('wf_app', () => gmail.getConnection(userId));
    expect(connection).toMatchObject({ email: 'fixture@gmail.com', status: 'connected' });
    const [row] = await test.query<{ tokens_enc: Uint8Array }>('SELECT tokens_enc FROM gmail_connections');
    expect(Buffer.from(row?.tokens_enc ?? []).toString()).not.toContain('private');
    expect(JSON.stringify(connection)).not.toContain('private');
    const calls = googleFetch.mock.calls.length;
    expect((await callback(`state=${state}&code=private-code`)).headers.get('location')).toContain('#gmail-failed');
    expect(googleFetch).toHaveBeenCalledTimes(calls);
  });
  it('refuses cancellation, state expiry/replay, wrong sessions and missing/current-2FA without egress', async () => {
    await test.as('wf_app', () => gmail.createConsent(userId, state, fakeSession().session.id, 'verifier'));
    const wrong = fakeSession();
    wrong.session.id = 'other-session';
    expect((await callback(`state=${state}&code=x`, requestContext(wrong))).headers.get('location')).toContain(
      '#gmail-failed',
    );
    expect((await callback(`state=${state}&code=x`, requestContext(null))).headers.get('location')).toContain(
      '#gmail-failed',
    );
    expect(
      (await callback(`state=${state}&code=x`, requestContext(fakeSession({ twoFactorEnabled: false })))).headers.get(
        'location',
      ),
    ).toContain('#gmail-failed');
    expect(
      (await callback(`state=${state}&code=x`, requestContext(fakeSession({ ageMinutes: 16 })))).headers.get(
        'location',
      ),
    ).toContain('#gmail-failed');
    expect((await callback(`state=${state}&error=access_denied`)).headers.get('location')).toContain(
      '#gmail-cancelled',
    );
    expect((await callback(`state=${state}&code=x`)).headers.get('location')).toContain('#gmail-failed');
    await test.as('wf_app', () => gmail.createConsent(userId, state, fakeSession().session.id, 'verifier'));
    clock = new Date(NOW.getTime() + 600001);
    expect((await callback(`state=${state}&code=x`)).headers.get('location')).toContain('#gmail-failed');
    expect(googleFetch).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('reconnects a revoked grant without losing filters and fails closed when disabled', async () => {
    const tokens = { accessToken: 'old-fixture', refreshToken: 'old-refresh', expiresAt: NOW };
    await test.as('wf_app', () =>
      gmail.saveConnection(userId, {
        email: 'fixture@gmail.com',
        tokens,
        filters: { senders: ['bank.test'], keywords: ['payment'], ignoreKeywords: ['promo'] },
      }),
    );
    await test.as('wf_app', () => gmail.markRevoked(userId));
    await test.as('wf_app', () => gmail.createConsent(userId, state, fakeSession().session.id, 'verifier'));
    await callback(`state=${state}&code=x`);
    expect(await test.as('wf_app', () => gmail.getConnection(userId))).toMatchObject({
      status: 'connected',
      filters: { senders: ['bank.test'] },
    });
    runtime.value.config = { ...config, google: null };
    googleFetch.mockClear();
    expect((await callback(`state=${state}&code=x`)).headers.get('location')).toContain('#gmail-failed');
    expect(googleFetch).not.toHaveBeenCalled();
  });

  it.each(['', 'state=bad', `state=${state}&state=${state}&code=x`])(
    'rejects malformed callback state before egress: %s',
    async (query) => {
      expect((await callback(query)).headers.get('location')).toContain('#gmail-failed');
      expect(googleFetch).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  it.each(['', 'code=x&code=y', `code=${'x'.repeat(4097)}`])(
    'consumes consent but refuses ambiguous or unbounded code: %s',
    async (query) => {
      await test.as('wf_app', () => gmail.createConsent(userId, state, fakeSession().session.id, 'verifier'));
      expect((await callback(`state=${state}&${query}`)).headers.get('location')).toContain('#gmail-failed');
      expect(googleFetch).not.toHaveBeenCalled();
      expect((await callback(`state=${state}&code=x`)).headers.get('location')).toContain('#gmail-failed');
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  it('does not save a short-lived grant without a refresh token', async () => {
    await test.as('wf_app', () => gmail.createConsent(userId, state, fakeSession().session.id, 'verifier'));
    googleFetch.mockResolvedValueOnce(Response.json({ access_token: 'private', expires_in: 3600, scope: GMAIL_SCOPE }));
    expect((await callback(`state=${state}&code=x`)).headers.get('location')).toContain('#gmail-failed');
    expect(await test.as('wf_app', () => gmail.getConnection(userId))).toBeNull();
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('Pub/Sub authenticated ingress', () => {
  it('verifies a real signature and exact issuer/audience/service account before mapping mailbox to ID-only work', async () => {
    await test.as('wf_app', () =>
      gmail.saveConnection(userId, {
        email: 'fixture@gmail.com',
        tokens: {
          accessToken: 'private-access',
          refreshToken: 'private-refresh',
          expiresAt: NOW,
        },
      }),
    );
    expect((await push()).status).toBe(204);
    expect(enqueue).toHaveBeenCalledWith(userId, 'push123');
    enqueue.mockClear();
    expect((await push('forged', 'fixture@gmail.com')).status).toBe(401);
    expect((await push(jwt({ email: 'attacker@fixture.iam.gserviceaccount.com' }))).status).toBe(401);
    expect((await push(jwt({ aud: 'https://evil.test' }))).status).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
    expect((await push(jwt(), 'other@gmail.com')).status).toBe(204);
    expect(enqueue).not.toHaveBeenCalled();
    await test.as('wf_app', () => gmail.markRevoked(userId));
    expect((await push()).status).toBe(204);
    expect(enqueue).not.toHaveBeenCalled();
  });
  it('never enqueues when the integration is disabled', async () => {
    runtime.value.config = { ...config, google: null };
    expect((await push()).status).toBe(404);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('bounds authorization, declared and streamed body sizes before mailbox lookup', async () => {
    const request = (body: BodyInit | null, headers: Record<string, string>) =>
      new Request('https://money.test/api/gmail/push', {
        method: 'POST',
        body,
        headers,
        duplex: 'half',
      } as RequestInit);
    for (const headers of [{}, { authorization: 'Basic private' }, { authorization: `Bearer ${'x'.repeat(8200)}` }]) {
      expect((await gmailPush({ request: request('{}', headers) })).status).toBe(401);
    }
    for (const req of [
      request('{}', { authorization: `Bearer ${jwt()}`, 'content-length': '16385' }),
      request(null, { authorization: `Bearer ${jwt()}` }),
      request('x'.repeat(16385), { authorization: `Bearer ${jwt()}` }),
    ])
      expect((await gmailPush({ request: req })).status).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it.each([
    { message: {} },
    { subscription: 'projects/other/subscriptions/mail', message: { messageId: '123', data: 'e30' } },
    { subscription: 'projects/fixture/subscriptions/mail', message: { messageId: 'bad', data: 'e30' } },
    { subscription: 'projects/fixture/subscriptions/mail', message: { messageId: '123', data: 'x'.repeat(4097) } },
    ...[
      {},
      { emailAddress: 1, historyId: '501' },
      { emailAddress: 'x'.repeat(255), historyId: '501' },
      { emailAddress: 'fixture@gmail.com', historyId: 501 },
      { emailAddress: 'fixture@gmail.com', historyId: 'bad' },
    ].map((event) => ({
      subscription: 'projects/fixture/subscriptions/mail',
      message: { messageId: '123', data: Buffer.from(JSON.stringify(event)).toString('base64url') },
    })),
  ])('refuses malformed signed notifications without enqueueing: %j', async (body) => {
    expect(
      (
        await gmailPush({
          request: new Request('https://money.test/api/gmail/push', {
            method: 'POST',
            headers: { authorization: `Bearer ${jwt()}` },
            body: JSON.stringify(body),
          }),
        })
      ).status,
    ).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('contains a cancellation failure on an oversized push stream', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(16385));
      },
      cancel() {
        throw new Error('private transport');
      },
    });
    const request = new Request('https://money.test/api/gmail/push', {
      method: 'POST',
      headers: { authorization: `Bearer ${jwt()}` },
      body,
      duplex: 'half',
    } as RequestInit);
    expect((await gmailPush({ request })).status).toBe(401);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
