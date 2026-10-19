// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /api/account-logo/$id` (FR-R1): the signed-in user's uploaded account logo, decrypted from the avatars
 * bucket. Another user's account, an account without a logo, and signed-out requests all answer 404, so the
 * response never reveals whether an id exists. The page links it with `?v=<logo key>`, so a cached copy is never
 * stale and may be kept.
 */
import { LedgerError } from '@wf/db/ledger-errors';
import * as z from 'zod';
import type { RequestContext } from './request-middleware.ts';
import { services } from './runtime.ts';

const NOT_FOUND = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });

export async function serveAccountLogo({
  context,
  params,
}: {
  context: Pick<RequestContext, 'session'>;
  params: { id: string };
}): Promise<Response> {
  const id = z.uuid().safeParse(params.id);
  const session = await context.session();
  if (!id.success || session === null) return NOT_FOUND();
  const { accounts, logoStore } = await services();
  let logoKey: string | null;
  try {
    ({ logoKey } = await accounts.get(session.user.id, id.data));
  } catch (error) {
    if (error instanceof LedgerError) return NOT_FOUND();
    throw error;
  }
  if (logoKey === null) return NOT_FOUND();
  const { bytes, mime } = await logoStore.get(session.user.id, logoKey);
  // A copy backed by a plain `ArrayBuffer`, as `Response` takes.
  return new Response(bytes.slice(), {
    headers: {
      'Content-Type': mime,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
