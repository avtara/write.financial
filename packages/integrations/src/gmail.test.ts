// SPDX-License-Identifier: AGPL-3.0-only
import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  createGmailClient,
  egressAllowed,
  fromAddress,
  gmailConsentUrl,
  gmailRequest,
  GMAIL_EXCERPT_MAX,
  GMAIL_SCOPE,
  GmailRevokedError,
  type GmailFetchPort,
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
const part = (mimeType: string, text: string, extra: Record<string, unknown> = {}) => ({
  mimeType,
  body: { data: Buffer.from(text).toString('base64url') },
  ...extra,
});
const fullClient = (payload: Record<string, unknown>, snippet = 'Gmail snippet') =>
  createGmailClient({
    oauth,
    fetch: (input) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith('/profile')) return json({ historyId: '1' });
      if (url.includes('/messages?')) return json({ messages: [{ id: 'a' }] });
      expect(url).toContain('format=full');
      return json({ ...message('a'), snippet, payload: { ...message('a').payload, ...payload } });
    },
  });
const excerpt = async (client: GmailFetchPort) => (await client.listMessages(tokens, null)).messages[0]?.excerpt;

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

  it.each([
    {},
    { access_token: 'a', expires_in: 0 },
    { access_token: 'a', expires_in: 86401 },
    { access_token: 'a', expires_in: 'bad' },
    { access_token: 'a', expires_in: 3600, scope: 'https://mail.google.com/' },
  ])('rejects malformed or overprivileged token grants: %j', async (grant) => {
    await expect(
      createGmailClient({ oauth, fetch: () => json(grant) }).exchange(
        'code',
        'verifier',
        'https://money.test/callback',
      ),
    ).rejects.toThrow('Gmail is unavailable');
  });

  it('retains an omitted refresh token during rotation but never invents one on first consent', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => json({ access_token: 'new', expires_in: 3600 }));
    const client = createGmailClient({ oauth, fetch: fetcher });
    expect((await client.exchange('code', 'verifier', 'https://money.test/callback')).refreshToken).toBeNull();
    fetcher
      .mockResolvedValueOnce(Response.json({ access_token: 'new', expires_in: 3600 }))
      .mockResolvedValueOnce(Response.json({ emailAddress: 'a@gmail.com', historyId: '1' }));
    const onRefresh = vi.fn();
    await client.profile({ ...tokens, expiresAt: new Date(0) }, { onRefresh });
    expect(onRefresh.mock.calls[0]?.[0]).toMatchObject({ refreshToken: tokens.refreshToken });
    await client.revoke({ ...tokens, refreshToken: null });
    expect(fetcher.mock.calls.at(-1)?.[1]?.body).toEqual(new URLSearchParams({ token: tokens.accessToken }));
  });

  it('bounds declared and actual responses, tolerates empty revocation responses, and contains cancellation errors', async () => {
    const native = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await gmailRequest('https://oauth2.googleapis.com/revoke', {}, { oauth })).toEqual({
      status: 204,
      body: undefined,
    });
    native.mockRestore();
    for (const response of [new Response(null), new Response('  ')])
      expect(
        (await gmailRequest('https://gmail.googleapis.com/a', {}, { oauth, fetch: () => Promise.resolve(response) }))
          .body,
      ).toBeUndefined();
    await expect(
      gmailRequest(
        'https://gmail.googleapis.com/a',
        {},
        {
          oauth,
          fetch: () => Promise.resolve(new Response('{}', { headers: { 'content-length': String(512 * 1024 + 1) } })),
        },
      ),
    ).rejects.toThrow('Gmail is unavailable');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(512 * 1024 + 1));
      },
      cancel() {
        throw new Error('private cancel diagnostics');
      },
    });
    await expect(
      gmailRequest('https://gmail.googleapis.com/a', {}, { oauth, fetch: () => Promise.resolve(new Response(stream)) }),
    ).rejects.toThrow('Gmail is unavailable');
  });

  it('refuses failed requests and malformed profile and watch identities', async () => {
    for (const [body, status] of [
      [null, 200],
      [{}, 200],
      [{ emailAddress: 'a@gmail.com', historyId: 'bad' }, 200],
      [{}, 503],
    ] as const) {
      await expect(createGmailClient({ oauth, fetch: () => json(body, status) }).profile(tokens)).rejects.toThrow();
    }
    for (const body of [{}, { historyId: '1', expiration: 'bad' }, { historyId: '1', expiration: '1' }]) {
      await expect(
        createGmailClient({ oauth, fetch: () => json(body) }).watch(tokens, 'projects/fixture/topics/mail'),
      ).rejects.toThrow();
    }
  });
});

describe('Gmail pagination, recovery and minimization', () => {
  it('collects every added message across history entries/pages, dedupes IDs, and reads each listed ID once', async () => {
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
        expect(url).toContain('format=full');
        expect(url).not.toContain('format=metadata');
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
  it('bounds a full sync to the newest page and continues from the pre-sync snapshot', async () => {
    const urls: string[] = [];
    const client = createGmailClient({
      oauth,
      fetch: (input) => {
        const url = input instanceof Request ? input.url : input.toString();
        urls.push(url);
        if (url.endsWith('/profile')) return json({ historyId: '700' });
        if (url.includes('/messages?')) return json({ messages: [{ id: 'new' }], nextPageToken: 'older' });
        return json(message('new'));
      },
    });
    expect(await client.listMessages(tokens, null)).toMatchObject({ historyId: '700', messages: [{ id: 'new' }] });
    expect(urls.some((url) => url.includes('pageToken='))).toBe(false);
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
        return json({ ...message('a'), snippet: 'x'.repeat(GMAIL_EXCERPT_MAX + 1000) });
      },
    });
    expect((await client.listMessages(tokens, null, { latest: 5 })).messages[0]?.excerpt).toHaveLength(
      GMAIL_EXCERPT_MAX,
    );
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

  it.each([0, 101, 1.5])(
    'refuses an invalid latest count instead of silently changing the evidence bound: %s',
    async (latest) => {
      const fetcher = vi.fn<typeof fetch>().mockImplementation(() => json({ historyId: '1' }));
      await expect(
        createGmailClient({ oauth, fetch: fetcher }).listMessages(tokens, null, { latest }),
      ).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it('tolerates removed messages, absent headers, and empty or malformed history collections without inventing a cursor', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({ messages: [{ id: 'gone' }, { id: 'bare' }, { id: 'bad id' }] }))
      .mockResolvedValueOnce(Response.json({}, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ internalDate: '1792288920000' }));
    expect(await createGmailClient({ oauth, fetch: fetcher }).listMessages(tokens, null)).toMatchObject({
      historyId: null,
      messages: [{ id: 'bare', from: '', subject: '', excerpt: '' }],
    });
    for (const history of [null, [{}, { messagesAdded: null }]]) {
      const client = createGmailClient({
        oauth,
        fetch: (input) =>
          (input instanceof Request ? input.url : input.toString()).endsWith('/profile')
            ? json({ historyId: '2' })
            : json({ history }),
      });
      expect((await client.listMessages(tokens, '1')).messages).toEqual([]);
    }
    const client = createGmailClient({
      oauth,
      fetch: (input) =>
        (input instanceof Request ? input.url : input.toString()).endsWith('/profile')
          ? json({})
          : json({ messages: {} }),
    });
    expect(await client.listMessages(tokens, null)).toEqual({ messages: [], historyId: null });
  });

  it('refuses an invalid received instant before staging evidence', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ historyId: '1' }))
      .mockResolvedValueOnce(Response.json({ messages: [{ id: 'a' }] }))
      .mockResolvedValueOnce(Response.json({ internalDate: 'not a date' }));
    await expect(createGmailClient({ oauth, fetch: fetcher }).listMessages(tokens, null)).rejects.toThrow(
      'Gmail is unavailable',
    );
  });
});

describe('Gmail message text', () => {
  it('prefers the first text/plain part of a nested multipart and never reads attachments', async () => {
    const client = fullClient({
      mimeType: 'multipart/mixed',
      parts: [
        part('text/plain', 'attached statement', { filename: 'statement.txt' }),
        { mimeType: 'application/pdf', filename: 'a.pdf', body: { attachmentId: 'att', size: 9 } },
        {
          mimeType: 'multipart/alternative',
          parts: [
            part('text/html', '<p>HTML version</p>'),
            {
              mimeType: 'multipart/related',
              parts: [part('text/plain', 'Jumlah:   Rp10.000\r\n\r\n\r\nBerhasil  \t ')],
            },
          ],
        },
      ],
    });
    expect(await excerpt(client)).toBe('Jumlah: Rp10.000\nBerhasil');
  });

  it('reduces a Krom-style HTML body to readable text with entities decoded', async () => {
    const html = [
      '<html><head><title>Krom</title><style>.x { color: red }</style></head><body>',
      '<!-- tracking --><script>alert("private")</script>',
      '<div><p>Transfer berhasil</p><table><tr><td>Tanggal &amp; Waktu</td><td>31 Okt 2026, 23:31 WIB</td></tr>',
      '</table><ul><li>Jumlah: Rp10.000</li><li>Ke: Toko &quot;Maju&quot; &#38; &#x4B;o&nbsp;&#39;s&apos;</li></ul>',
      'Baris<br/>baru &copy; &#xD800;</div></body></html>',
    ].join('');
    const text = await excerpt(fullClient(part('text/html', html)));
    expect(text).toContain('Tanggal & Waktu 31 Okt 2026, 23:31 WIB');
    expect(text).toContain('• Jumlah: Rp10.000\n• Ke: Toko "Maju" & Ko \'s\'');
    expect(text).toContain('Baris\nbaru &copy; &#xD800;');
    for (const hidden of ['Krom', 'color', 'tracking', 'alert', '<', '>']) expect(text).not.toContain(hidden);
    expect(await excerpt(fullClient(part('text/html', 'Rp10.000<!-- unclosed <b>hidden</b>')))).toBe('Rp10.000');
  });

  it('decodes the declared charset and bounds the text without splitting a character', async () => {
    const latin = {
      mimeType: 'text/plain',
      headers: [{ name: 'Content-Type', value: 'text/plain; charset="ISO-8859-1"' }],
      body: { data: Buffer.from('Caf\u00e9 Rp10.000', 'latin1').toString('base64url') },
    };
    expect(await excerpt(fullClient(latin))).toBe('Caf\u00e9 Rp10.000');
    const unknown = { ...latin, headers: [{ name: 'content-type', value: 'text/plain; charset=x-unknown' }] };
    expect(await excerpt(fullClient({ ...unknown, ...part('text/plain', 'Rp10.000') }))).toBe('Rp10.000');
    const emoji = await excerpt(fullClient(part('text/plain', `${'x'.repeat(GMAIL_EXCERPT_MAX - 1)}\u{1F600} tail`)));
    expect(emoji).toBe('x'.repeat(GMAIL_EXCERPT_MAX - 1));
  });

  it('falls back to the decoded snippet when no readable text part exists within the walk bounds', async () => {
    const deep = Array.from({ length: 10 }).reduce<Record<string, unknown>>(
      (inner) => ({ mimeType: 'multipart/mixed', parts: [inner] }),
      part('text/plain', 'too deep'),
    );
    for (const payload of [
      {},
      { mimeType: 'text/plain', body: { size: 0 } },
      part('text/plain', '  \n '),
      part('text/csv', 'a,b'),
      deep,
      {
        mimeType: 'multipart/mixed',
        parts: [...Array.from({ length: 70 }, () => part('image/png', 'x')), part('text/plain', 'too late')],
      },
    ])
      expect(await excerpt(fullClient(payload, 'Tanggal &amp; Waktu&#58; 31 Okt'))).toBe('Tanggal & Waktu: 31 Okt');
  });

  it('falls back to metadata and the snippet for a message too large to read, without failing the sync', async () => {
    const urls: string[] = [];
    const client = createGmailClient({
      oauth,
      fetch: (input) => {
        const url = input instanceof Request ? input.url : input.toString();
        urls.push(url);
        if (url.endsWith('/profile')) return json({ historyId: '1' });
        if (url.includes('/messages?')) return json({ messages: [{ id: 'big' }, { id: 'small' }] });
        if (url.includes('/messages/big?format=full')) return Promise.resolve(new Response('x'.repeat(512 * 1024 + 1)));
        if (url.includes('/messages/small?format=full'))
          return json({ ...message('small'), payload: { ...message('small').payload, ...part('text/plain', 'Body') } });
        return json({ ...message('big'), snippet: 'Tanggal &amp; Waktu' });
      },
    });
    expect((await client.listMessages(tokens, null)).messages).toMatchObject([
      { id: 'big', subject: 'PLN payment', excerpt: 'Tanggal & Waktu' },
      { id: 'small', excerpt: 'Body' },
    ]);
    expect(urls.filter((url) => url.includes('/messages/big?'))).toEqual([
      expect.stringContaining('format=full'),
      expect.stringContaining('format=metadata&metadataHeaders=From&metadataHeaders=Subject'),
    ]);
    const refused = createGmailClient({
      oauth,
      fetch: (input) => {
        const url = input instanceof Request ? input.url : input.toString();
        if (url.endsWith('/profile')) return json({ historyId: '1' });
        if (url.includes('/messages?')) return json({ messages: [{ id: 'a' }] });
        return json({}, 503);
      },
    });
    await expect(refused.listMessages(tokens, null)).rejects.toMatchObject({ status: 503 });
    const assertCurrent = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValue(new Error('disconnected'));
    await expect(refused.listMessages(tokens, null, { assertCurrent })).rejects.toThrow('disconnected');
    expect(assertCurrent).toHaveBeenCalledTimes(3);
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

  it('fails closed for oversized tokens, unavailable signing keys, and absent or mismatched key sets', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(verifyGmailPush('x'.repeat(8193), expected, fetch)).rejects.toThrow('Push authentication refused');
    expect(fetch).not.toHaveBeenCalled();
    for (const response of [
      new Response('private provider', { status: 503 }),
      Response.json({}),
      Response.json({ keys: [] }),
      Response.json({ keys: [{ ...jwk, kid: 'other' }] }),
    ]) {
      fetch.mockResolvedValueOnce(response);
      await expect(verifyGmailPush(token(), expected, fetch)).rejects.toThrow('Push authentication refused');
    }
  });
});
