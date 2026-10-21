// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /api/account-logo/$id` (FR-R1) and `GET /api/subscription-logo/$id` (FR-SUB1): the signed-in user's uploaded
 * logo of one of their accounts or subscriptions, decrypted from the avatars bucket. Another user's entity, one
 * without a logo, and signed-out requests all answer 404, so the response never reveals whether an id exists. Pages
 * link it with `?v=<logo key>`, so a cached copy is never stale and may be kept.
 */
import { LedgerError } from '@wf/db/ledger-errors';
import * as z from 'zod';
import type { RequestContext } from './request-middleware.ts';
import { services, type Services } from './runtime.ts';

const NOT_FOUND = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });

interface LogoRequest {
  context: Pick<RequestContext, 'session'>;
  params: { id: string };
}

/** The entity's logo key; `LedgerError`s (not found, not the user's) answer 404. */
type LogoLookup = (all: Services, userId: string, id: string) => Promise<{ logoKey: string | null }>;

async function serveLogo({ context, params }: LogoRequest, lookup: LogoLookup): Promise<Response> {
  const id = z.uuid().safeParse(params.id);
  const session = await context.session();
  if (!id.success || session === null) return NOT_FOUND();
  const all = await services();
  let logoKey: string | null;
  try {
    ({ logoKey } = await lookup(all, session.user.id, id.data));
  } catch (error) {
    if (error instanceof LedgerError) return NOT_FOUND();
    throw error;
  }
  if (logoKey === null) return NOT_FOUND();
  const { bytes, mime } = await all.logoStore.get(session.user.id, logoKey);
  // A copy backed by a plain `ArrayBuffer`, as `Response` takes.
  return new Response(bytes.slice(), {
    headers: {
      'Content-Type': mime,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function serveAccountLogo(request: LogoRequest): Promise<Response> {
  return serveLogo(request, ({ accounts }, userId, id) => accounts.get(userId, id));
}

export function serveSubscriptionLogo(request: LogoRequest): Promise<Response> {
  return serveLogo(request, ({ schedules }, userId, id) => schedules.getSubscription(userId, id));
}
