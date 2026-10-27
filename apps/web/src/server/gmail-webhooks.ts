// SPDX-License-Identifier: AGPL-3.0-only
import { verifyGmailPush } from '@wf/integrations/gmail';
import { requireSession } from './access.ts';
import type { RequestContext } from './request-middleware.ts';
import { services } from './runtime.ts';

/** Fixed callback destination and no third-party resources: never echo OAuth parameters or provider diagnostics. */
export async function gmailCallback({
  request,
  context,
}: {
  request: Request;
  context: Pick<RequestContext, 'session'>;
}): Promise<Response> {
  const s = await services();
  const finish = (result: 'connected' | 'failed' | 'cancelled') =>
    new Response(null, {
      status: 303,
      headers: {
        Location: new URL(`/?settings=gmail#gmail-${result}`, s.config.publicUrl).href,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    });
  try {
    if (s.config.google?.gmail == null) return finish('failed');
    const current = await requireSession(context.session, { twoFactor: true, fresh: true }, s.now());
    const url = new URL(request.url);
    const state = url.searchParams.get('state');
    if (state === null || !/^[a-f0-9]{64}$/.test(state) || url.searchParams.getAll('state').length !== 1)
      return finish('failed');
    const { verifier, grantId } = await s.gmail.consumeConsent(current.user.id, state, current.session.id);
    if (url.searchParams.has('error')) return finish('cancelled');
    const code = url.searchParams.get('code');
    if (code === null || code.length > 4096 || url.searchParams.getAll('code').length !== 1) return finish('failed');
    const tokens = await s.gmailFetch.exchange(code, verifier, new URL('/api/gmail/callback', s.config.publicUrl).href);
    if (tokens.refreshToken === null) return finish('failed');
    // Gmail profile comes from the grant, not an untrusted callback email or the sign-in account table.
    const profile = await s.gmailFetch.profile(tokens);
    await s.gmail.saveConnection(current.user.id, { email: profile.email, tokens, expectedGrantId: grantId });
    await s.gmailQueue.enqueue(current.user.id, `connect${crypto.randomUUID()}`);
    return finish('connected');
  } catch {
    return finish('failed');
  }
}

/** The Google signature, issuer, exact audience and push service-account identity precede all mailbox lookup. */
export async function gmailPush({ request }: { request: Request }): Promise<Response> {
  const s = await services();
  const gmail = s.config.google?.gmail;
  const headers = { 'Cache-Control': 'no-store' };
  if (gmail == null) return new Response(null, { status: 404, headers });
  try {
    const authorization = request.headers.get('authorization') ?? '';
    if (!authorization.startsWith('Bearer ') || authorization.length > 8200) throw new Error();
    await verifyGmailPush(authorization.slice(7), {
      audience: new URL('/api/gmail/push', s.config.publicUrl).href,
      serviceAccount: gmail.pushServiceAccount,
    });
    if (Number(request.headers.get('content-length')) > 16_384) throw new Error();
    const reader = request.body?.getReader();
    if (reader === undefined) throw new Error();
    let bytes = 0;
    let text = '';
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 16_384) throw new Error();
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const body = JSON.parse(text) as { message?: { data?: unknown; messageId?: unknown }; subscription?: unknown };
    const data = body.message?.data;
    const messageId = body.message?.messageId;
    if (
      typeof data !== 'string' ||
      data.length > 4096 ||
      typeof messageId !== 'string' ||
      !/^\d{1,128}$/.test(messageId) ||
      typeof body.subscription !== 'string' ||
      !body.subscription.startsWith(`projects/${gmail.cloudProject}/subscriptions/`)
    )
      throw new Error();
    const event = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as {
      emailAddress?: unknown;
      historyId?: unknown;
    };
    if (
      typeof event.emailAddress !== 'string' ||
      event.emailAddress.length > 254 ||
      typeof event.historyId !== 'string' ||
      !/^\d{1,40}$/.test(event.historyId)
    )
      throw new Error();
    for (const { userId } of await s.gmail.targets(event.emailAddress.toLowerCase()))
      await s.gmailQueue.enqueue(userId, `push${messageId}`);
    return new Response(null, { status: 204, headers });
  } catch {
    return new Response(null, { status: 401, headers });
  }
}
