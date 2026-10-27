// SPDX-License-Identifier: AGPL-3.0-only
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createGmailClient,
  egressAllowed,
  fromAddress,
  gmailConsentUrl,
  gmailRequest,
  GMAIL_SCOPE,
  GmailRevokedError,
  verifyGmailPush,
} from './gmail.ts';
const tokens = { accessToken: 'fixture-access', refreshToken: 'fixture-refresh', expiresAt: new Date('2099-01-01') };
const oauth = { clientId: 'fixture-client', clientSecret: 'fixture-secret' };
const json = (value: unknown, status = 200) => Promise.resolve(Response.json(value, { status }));
const message = (id: string) => ({
  id,
  internalDate: '1792288920000',
  snippet: 'PLN paid 350000 IDR',
  payload: {
    headers: [
      { name: 'from', value: 'Bank <PAY@BANK.TEST>' },
      { name: 'Subject', value: 'PLN payment' },
    ],
  },
});

describe('separate Gmail OAuth and fixed egress', () => {
  it('requests only readonly Gmail with offline consent, session state and S256 PKCE', async () => {
    const url = new URL(await gmailConsentUrl('client', 'https://money.test/api/gmail/callback', 'state', 'verifier'));
    expect(url.origin).toBe('https://accounts.google.com');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      scope: GMAIL_SCOPE,
      include_granted_scopes: 'false',
      access_type: 'offline',
      prompt: 'consent',
      state: 'state',
      code_challenge_method: 'S256',
      redirect_uri: 'https://money.test/api/gmail/callback',
    });
    expect(url.searchParams.get('code_challenge')).not.toBe('verifier');
    expect(url.searchParams.get('code_challenge')).toHaveLength(43);
  });
  it('refuses alternate hosts, ports, credentials, schemes and redirects without leaking provider diagnostics', async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const url of [
      'http://gmail.googleapis.com/a',
      'https://gmail.googleapis.com.evil.test',
      'https://u:p@gmail.googleapis.com/a',
      'https://gmail.googleapis.com:444/a',
      'invalid',
    ]) {
      expect(egressAllowed(url)).toBe(false);
      await expect(gmailRequest(url, {}, { oauth, fetch: fetcher })).rejects.toThrow('Gmail destination refused');
    }
    expect(fetcher).not.toHaveBeenCalled();
    fetcher.mockRejectedValue(new Error('private provider text'));
    await expect(gmailRequest('https://gmail.googleapis.com/a', {}, { oauth, fetch: fetcher })).rejects.toThrow(
      'Gmail is unavailable',
    );
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'error' });
  });
  it('exchanges and refreshes through form bodies, persists rotation before reads, and refuses revoked grants', async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    const refreshed = vi.fn();
    const fetcher: typeof fetch = (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      requests.push({ url, init });
      if (url.endsWith('/token'))
        return json({
          access_token: 'new-fixture-access',
          refresh_token: 'new-fixture-refresh',
          expires_in: 3600,
          scope: GMAIL_SCOPE,
        });
      expect(refreshed).toHaveBeenCalled();
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer new-fixture-access');
      return json({ emailAddress: 'FIXTURE@GMAIL.COM', historyId: '200' });
    };
    const client = createGmailClient({ oauth, fetch: fetcher });
    const exchanged = await client.exchange('code', 'verifier', 'https://money.test/api/gmail/callback');
    expect(exchanged.refreshToken).toBe('new-fixture-refresh');
    const fields = requests[0]?.init?.body;
    expect(fields).toBeInstanceOf(URLSearchParams);
    if (!(fields instanceof URLSearchParams)) throw new Error('Expected OAuth form body');
    expect(fields.get('code_verifier')).toBe('verifier');
    expect(fields.get('redirect_uri')).toBe('https://money.test/api/gmail/callback');
    await client.profile({ ...tokens, expiresAt: new Date(0) }, { onRefresh: refreshed });
    expect(refreshed.mock.calls[0]?.[0]).toMatchObject({
      accessToken: 'new-fixture-access',
      refreshToken: 'new-fixture-refresh',
    });
    expect(requests.every(({ url }) => !url.includes('fixture-access') && !url.includes('fixture-secret'))).toBe(true);
    await expect(
      createGmailClient({ oauth, fetch: () => json({ error: 'invalid_grant' }, 400) }).profile({
        ...tokens,
        expiresAt: new Date(0),
      }),
    ).rejects.toBeInstanceOf(GmailRevokedError);
    await expect(client.profile({ ...tokens, refreshToken: null, expiresAt: new Date(0) })).rejects.toBeInstanceOf(
      GmailRevokedError,
    );
  });
});

describe('Gmail pagination, recovery and minimization', () => {
  it('collects every added message across history entries/pages, dedupes IDs, and only asks for metadata', async () => {
    const urls: string[] = [];
    const client = createGmailClient({
      oauth,
      fetch: (input) => {
        const url = input instanceof Request ? input.url : input.toString();
        urls.push(url);
        if (url.endsWith('/profile')) return json({ historyId: '300' });
        if (url.includes('/history?'))
          return url.includes('pageToken=next')
            ? json({
                historyId: '305',
                history: [{ messagesAdded: [{ message: { id: 'b' } }, { message: { id: 'c' } }] }],
              })
            : json({
                historyId: '305',
                nextPageToken: 'next',
                history: [{ messagesAdded: [{ message: { id: 'a' } }, { message: { id: 'b' } }] }],
              });
        const id = new URL(url).pathname.split('/').at(-1) ?? '';
        expect(url).toContain('format=metadata');
        expect(url).not.toContain('format=full');
        return json(message(id));
      },
    });
    const page = await client.listMessages(tokens, '100');
    expect(page.historyId).toBe('305');
    expect(page.messages.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(page.messages[0]).toMatchObject({
      from: 'pay@bank.test',
      subject: 'PLN payment',
      excerpt: 'PLN paid 350000 IDR',
    });
    expect(urls.filter((url) => url.includes('/messages/b?'))).toHaveLength(1);
  });
  it('recovers expired history with a pre-sync cursor so concurrent newer mail cannot be lost', async () => {
    const client = createGmailClient({
      oauth,
      fetch: (input) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (url.endsWith('/profile')) return json({ historyId: '500' });
        if (url.includes('/history?')) return json({}, 404);
        if (url.includes('/messages?')) return json({ messages: [{ id: 'a' }] });
        return json({ ...message('a'), historyId: '550' });
      },
    });
    expect(await client.listMessages(tokens, 'expired')).toMatchObject({ historyId: '500', messages: [{ id: 'a' }] });
  });
  it('tests the latest five only and enforces bounded response/page/message evidence', async () => {
    const urls: string[] = [];
    const client = createGmailClient({
      oauth,
      fetch: (input) => {
        const url = input instanceof Request ? input.url : input.toString();
        urls.push(url);
        if (url.endsWith('/profile')) return json({ historyId: '5' });
        if (url.includes('/messages?')) return json({ messages: [{ id: 'a' }], nextPageToken: 'unread' });
        return json({ ...message('a'), snippet: 'x'.repeat(2000) });
      },
    });
    expect((await client.listMessages(tokens, null, { latest: 5 })).messages[0]?.excerpt).toHaveLength(1000);
    expect(urls.some((url) => url.includes('maxResults=5'))).toBe(true);
    expect(urls.some((url) => url.includes('pageToken='))).toBe(false);
    await expect(
      createGmailClient({ oauth, fetch: () => Promise.resolve(new Response('x'.repeat(512 * 1024 + 1))) }).profile(
        tokens,
      ),
    ).rejects.toThrow();
    const paging = createGmailClient({
      oauth,
      fetch: (input) =>
        (input instanceof Request ? input.url : input.toString()).endsWith('/profile')
          ? json({ historyId: '5' })
          : json({ history: [], nextPageToken: 'forever' }),
    });
    await expect(paging.listMessages(tokens, '1')).rejects.toThrow('Gmail pagination limit reached');
  });
  it('checks a live grant before each request and renews watches with the configured topic', async () => {
    const assertCurrent = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() => json({ historyId: '9', expiration: String(Date.now() + 86400000) }));
    const client = createGmailClient({ oauth, fetch: fetcher });
    await client.watch(tokens, 'projects/fixture/topics/mail', { assertCurrent });
    const watchBody = fetcher.mock.calls[0]?.[1]?.body;
    expect(watchBody).toBeTypeOf('string');
    if (typeof watchBody !== 'string') throw new Error('Expected watch JSON body');
    expect(JSON.parse(watchBody)).toEqual({ topicName: 'projects/fixture/topics/mail' });
    assertCurrent.mockRejectedValue(new Error('disconnected'));
    await expect(client.profile(tokens, { assertCurrent })).rejects.toThrow('disconnected');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await client.revoke(tokens);
    const revokeBody = fetcher.mock.calls[1]?.[1]?.body;
    expect(revokeBody).toBeInstanceOf(URLSearchParams);
    if (!(revokeBody instanceof URLSearchParams)) throw new Error('Expected revocation form body');
    expect(revokeBody.get('token')).toBe('fixture-refresh');
    expect(fromAddress('Bank <USER@BANK.TEST>')).toBe('user@bank.test');
    expect(fromAddress('not a mailbox')).toBe('');
  });
});

describe('authenticated Pub/Sub identity', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const expected = {
    audience: 'https://money.test/api/gmail/push',
    serviceAccount: 'push@fixture.iam.gserviceaccount.com',
  };
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'RS256' };
  const token = (override: Record<string, unknown> = {}) => {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({
        iss: 'https://accounts.google.com',
        aud: expected.audience,
        email: expected.serviceAccount,
        email_verified: true,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        ...override,
      }),
    ).toString('base64url');
    return `${header}.${body}.${sign('RSA-SHA256', Buffer.from(`${header}.${body}`), privateKey).toString('base64url')}`;
  };
  const fetcher: typeof fetch = (input, init) => {
    expect(input instanceof Request ? input.url : input.toString()).toBe('https://www.googleapis.com/oauth2/v3/certs');
    expect(init?.redirect).toBe('error');
    return json({ keys: [jwk] });
  };
  it('accepts a real RSA signature only for the exact expected verified service-account identity and audience', async () => {
    await expect(verifyGmailPush(token(), expected, fetcher)).resolves.toBeUndefined();
    for (const override of [
      { aud: 'https://evil.test' },
      { iss: 'https://evil.test' },
      { email: 'attacker@fixture.iam.gserviceaccount.com' },
      { email_verified: false },
      { exp: 0 },
      { iat: 0 },
    ])
      await expect(verifyGmailPush(token(override), expected, fetcher)).rejects.toThrow('Push authentication refused');
    await expect(verifyGmailPush(`${token().slice(0, -10)}invalid`, expected, fetcher)).rejects.toThrow();
    await expect(verifyGmailPush('bad', expected, fetcher)).rejects.toThrow();
  });
});
