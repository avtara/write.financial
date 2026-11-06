// SPDX-License-Identifier: AGPL-3.0-only
/** A title-only, uncached read endpoint; every lookup runs in the session user's RLS scope. */
import { UnauthenticatedError } from '@wf/auth/session';
import * as z from 'zod';
import { requireSession } from './access.ts';
import type { RequestContext } from './request-middleware.ts';
import { services } from './runtime.ts';

const INPUT = z.object({ query: z.string().trim().min(2).max(200), type: z.enum(['expense', 'income', 'transfer']) });
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export async function serveTransactionTitles({
  request,
  context,
}: {
  request: Request;
  context: Pick<RequestContext, 'session'>;
}): Promise<Response> {
  const s = await services();
  let userId: string;
  try {
    userId = (await requireSession(context.session, {}, s.now())).user.id;
  } catch (error) {
    if (error instanceof UnauthenticatedError)
      return Response.json({ ok: false, code: 'UNAUTHENTICATED' }, { status: 401, headers: HEADERS });
    throw error;
  }
  const params = new URL(request.url).searchParams;
  const input = INPUT.safeParse({ query: params.get('query'), type: params.get('type') });
  if (!input.success) return Response.json({ ok: false, code: 'INVALID_QUERY' }, { status: 400, headers: HEADERS });
  const titles = await s.transactionQuery.suggestTitles(userId, input.data);
  return Response.json({ titles }, { headers: HEADERS });
}
