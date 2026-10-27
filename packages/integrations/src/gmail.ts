// SPDX-License-Identifier: AGPL-3.0-only
import type { webcrypto } from 'node:crypto';

export interface GmailTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly expiresAt: Date;
}
export interface GmailMessage {
  readonly id: string;
  readonly from: string;
  readonly subject: string;
  readonly excerpt: string;
  readonly receivedAt: Date;
}
export interface GmailPage {
  readonly messages: GmailMessage[];
  readonly historyId: string | null;
}
export interface GmailReadOptions {
  readonly latest?: number;
  /** Rechecked immediately before every network request, including refresh and pagination. */
  readonly assertCurrent?: () => Promise<void>;
  readonly onRefresh?: (tokens: GmailTokenSet) => Promise<void>;
}
export interface GmailFetchPort {
  listMessages(tokens: GmailTokenSet, historyId: string | null, options?: GmailReadOptions): Promise<GmailPage>;
  watch(
    tokens: GmailTokenSet,
    topic: string,
    options?: GmailReadOptions,
  ): Promise<{ historyId: string; expiresAt: Date }>;
  revoke(tokens: GmailTokenSet): Promise<void>;
  exchange(code: string, verifier: string, redirectUri: string): Promise<GmailTokenSet>;
  profile(tokens: GmailTokenSet, options?: GmailReadOptions): Promise<{ email: string; historyId: string }>;
}
export class GmailRevokedError extends Error {
  override readonly name = 'GmailRevokedError';
}
export class GmailUnavailableError extends Error {
  override readonly name = 'GmailUnavailableError';
  readonly status: number | null;
  constructor(message = 'Gmail is unavailable', status: number | null = null) {
    super(message);
    this.status = status;
  }
}
export const GMAIL_HOSTS = ['oauth2.googleapis.com', 'gmail.googleapis.com'] as const;
export const GMAIL_PAGE_SIZE = 25;
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const ROOT = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const MAX_BODY = 512 * 1024;
const MAX_PAGES = 100;
export interface GmailClientOptions {
  readonly oauth: { readonly clientId: string; readonly clientSecret: string };
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}
export function egressAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      parsed.port === '' &&
      !parsed.username &&
      !parsed.password &&
      (GMAIL_HOSTS as readonly string[]).includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}
async function boundedJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > MAX_BODY) throw new GmailUnavailableError();
  const reader = response.body?.getReader() as ReadableStreamDefaultReader<Uint8Array> | undefined;
  if (reader === undefined) return undefined;
  let text = '';
  let size = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY) throw new GmailUnavailableError();
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text.trim() === '' ? undefined : (JSON.parse(text) as unknown);
  } catch {
    throw new GmailUnavailableError();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
export async function gmailRequest(
  url: string,
  init: Readonly<RequestInit>,
  options: GmailClientOptions,
): Promise<{ status: number; body: unknown }> {
  if (!egressAllowed(url)) throw new GmailUnavailableError('Gmail destination refused');
  try {
    const response = await (options.fetch ?? globalThis.fetch)(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    });
    return { status: response.status, body: response.status === 204 ? undefined : await boundedJson(response) };
  } catch {
    throw new GmailUnavailableError();
  }
}
function object(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function checked(answer: { status: number; body: unknown }): Record<string, unknown> {
  if (answer.status === 401 || (answer.status === 400 && object(answer.body).error === 'invalid_grant'))
    throw new GmailRevokedError('Gmail permission revoked');
  if (answer.status < 200 || answer.status >= 300)
    throw new GmailUnavailableError('Gmail request refused', answer.status);
  return object(answer.body);
}
export function fromAddress(from: string): string {
  return (/^\s*(?:[^<>]*<)?([^<>\s]+@[^<>\s]+)>?\s*$/.exec(from)?.[1] ?? '').toLowerCase();
}
export async function gmailConsentUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  verifier: string,
): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const challenge = btoa(String.fromCharCode(...hash))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.href;
}
export function createGmailClient(options: GmailClientOptions): GmailFetchPort {
  const grant = async (fields: Record<string, string>, previous?: GmailTokenSet): Promise<GmailTokenSet> => {
    const body = checked(
      await gmailRequest(
        TOKEN_URL,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: options.oauth.clientId,
            client_secret: options.oauth.clientSecret,
            ...fields,
          }),
        },
        options,
      ),
    );
    const accessToken = string(body.access_token);
    const expires = Number(body.expires_in);
    if (
      !accessToken ||
      !Number.isFinite(expires) ||
      expires <= 0 ||
      expires > 86_400 ||
      (body.scope !== undefined &&
        string(body.scope)
          .split(' ')
          .some((scope) => scope !== GMAIL_SCOPE))
    )
      throw new GmailUnavailableError();
    return {
      accessToken,
      refreshToken: string(body.refresh_token) || previous?.refreshToken || null,
      expiresAt: new Date(Date.now() + expires * 1000),
    };
  };
  const session = (initial: GmailTokenSet, read: GmailReadOptions = {}) => {
    let tokens = initial;
    return async (path: string, init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {}) => {
      await read.assertCurrent?.();
      if (tokens.expiresAt.getTime() <= Date.now() + 60_000) {
        if (!tokens.refreshToken) throw new GmailRevokedError('Gmail permission revoked');
        tokens = await grant({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken }, tokens);
        await read.onRefresh?.(tokens);
        await read.assertCurrent?.();
      }
      return gmailRequest(
        `${ROOT}${path}`,
        {
          ...init,
          headers: { ...init.headers, Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json' },
        },
        options,
      );
    };
  };
  return {
    exchange: (code, verifier, redirectUri) =>
      grant({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri }),
    async profile(tokens, read) {
      const request = session(tokens, read);
      const data = checked(await request('/profile'));
      if (!string(data.emailAddress) || !/^\d+$/.test(string(data.historyId))) throw new GmailUnavailableError();
      return { email: string(data.emailAddress).toLowerCase(), historyId: string(data.historyId) };
    },
    async watch(tokens, topic, read) {
      const request = session(tokens, read);
      const data = checked(
        await request('/watch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topicName: topic }),
        }),
      );
      const expiresAt = new Date(Number(data.expiration));
      if (
        !/^\d+$/.test(string(data.historyId)) ||
        !Number.isFinite(expiresAt.getTime()) ||
        expiresAt.getTime() <= Date.now()
      )
        throw new GmailUnavailableError();
      return { historyId: string(data.historyId), expiresAt };
    },
    async revoke(tokens) {
      // Local tombstone must already be committed before this best-effort external operation.
      await gmailRequest(
        'https://oauth2.googleapis.com/revoke',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: tokens.refreshToken ?? tokens.accessToken }),
        },
        options,
      );
    },
    async listMessages(tokens, historyId, read = {}) {
      const request = session(tokens, read);
      // Snapshot BEFORE a full sync. Changes during pagination are read on the next history poll, never skipped.
      const profile = checked(await request('/profile'));
      let cursor = historyId;
      let next = '';
      let latest = string(profile.historyId);
      const ids = new Set<string>();
      const messages: GmailMessage[] = [];
      const limit = read.latest ?? GMAIL_PAGE_SIZE;
      if (!Number.isInteger(limit) || limit < 1 || limit > GMAIL_PAGE_SIZE) throw new GmailUnavailableError();
      for (let page = 0; page < MAX_PAGES; page++) {
        const params = new URLSearchParams({ maxResults: String(limit) });
        if (next) params.set('pageToken', next);
        if (cursor !== null) {
          params.set('startHistoryId', cursor);
          params.set('historyTypes', 'messageAdded');
        }
        const answer = await request(`${cursor === null ? '/messages' : '/history'}?${params.toString()}`);
        if (answer.status === 404 && cursor !== null) {
          cursor = null;
          next = '';
          continue;
        }
        const data = checked(answer);
        if (cursor !== null && string(data.historyId)) latest = string(data.historyId);
        const rows =
          cursor === null
            ? data.messages
            : Array.isArray(data.history)
              ? data.history.flatMap((entry) => {
                  const added = object(entry).messagesAdded;
                  return Array.isArray(added) ? added.map((row) => object(row).message) : [];
                })
              : [];
        for (const row of Array.isArray(rows) ? rows : []) {
          const id = string(object(row).id);
          if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id) || ids.has(id)) continue;
          ids.add(id);
          const answer = await request(
            `/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`,
          );
          if (answer.status === 404) continue;
          const message = checked(answer);
          const headers = object(message.payload).headers;
          const header = (name: string) =>
            Array.isArray(headers)
              ? string(object(headers.find((entry) => string(object(entry).name).toLowerCase() === name)).value)
              : '';
          const receivedAt = new Date(Number(message.internalDate));
          if (!Number.isFinite(receivedAt.getTime())) throw new GmailUnavailableError();
          messages.push({
            id,
            from: fromAddress(header('from')).slice(0, 254),
            subject: header('subject').slice(0, 500),
            excerpt: string(message.snippet).slice(0, 1000),
            receivedAt,
          });
        }
        next = string(data.nextPageToken);
        if (!next || read.latest !== undefined)
          return {
            messages: read.latest === undefined ? messages : messages.slice(0, read.latest),
            historyId: latest || null,
          };
      }
      // Never advance history past unprocessed pages. A bounded failure retries from the durable cursor.
      throw new GmailUnavailableError('Gmail pagination limit reached');
    },
  };
}

/** Signature verification uses Google's fixed public-key endpoint, never a JWT-supplied URL. */
export async function verifyGmailPush(
  token: string,
  expected: { audience: string; serviceAccount: string },
  fetcher: typeof fetch = globalThis.fetch,
): Promise<void> {
  if (token.length > 8192) throw new GmailUnavailableError('Push authentication refused');
  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error();
    const [head, body, signature] = parts as [string, string, string];
    const header = object(JSON.parse(Buffer.from(head, 'base64url').toString()));
    const claims = object(JSON.parse(Buffer.from(body, 'base64url').toString()));
    const now = Date.now() / 1000;
    if (
      header.alg !== 'RS256' ||
      typeof header.kid !== 'string' ||
      !['https://accounts.google.com', 'accounts.google.com'].includes(string(claims.iss)) ||
      claims.aud !== expected.audience ||
      claims.email !== expected.serviceAccount ||
      claims.email_verified !== true ||
      typeof claims.exp !== 'number' ||
      claims.exp <= now ||
      typeof claims.iat !== 'number' ||
      claims.iat > now + 30 ||
      claims.iat < now - 3900
    )
      throw new Error();
    const response = await fetcher('https://www.googleapis.com/oauth2/v3/certs', {
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error();
    const keys = object(await boundedJson(response)).keys;
    const key: unknown = Array.isArray(keys)
      ? keys.find((key) => object(key).kid === header.kid && object(key).kty === 'RSA' && object(key).alg === 'RS256')
      : undefined;
    if (key === undefined) throw new Error();
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      key as webcrypto.JsonWebKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    if (
      !(await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        publicKey,
        new Uint8Array(Buffer.from(signature, 'base64url')),
        new TextEncoder().encode(`${head}.${body}`),
      ))
    )
      throw new Error();
  } catch {
    throw new GmailUnavailableError('Push authentication refused');
  }
}
