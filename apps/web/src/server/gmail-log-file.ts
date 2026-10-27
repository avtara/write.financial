// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /api/gmail/log` (FR-AI4): streams the signed-in user's entire retained log as CSV in bounded keyset pages,
 * including validated extracted values and field confidence, never credential material. Exporting requires 2FA (FR-A9,
 * as the data export); a signed-out request answers 401 and an unverified one 403, both as a small JSON body. The
 * response is an attachment, never cached, and cannot run script or be embedded (`nosniff`, CSP `sandbox`, CORP).
 */
import { UnauthenticatedError, TwoFactorRequiredError } from '@wf/auth/session';
import { downloadHeaders } from '@wf/integrations/download';
import { gmailLogCsv } from './fn/gmail.ts';
import { requireSession } from './access.ts';
import type { RequestContext } from './request-middleware.ts';
import { services } from './runtime.ts';

const REFUSED = (status: number, code: string) =>
  Response.json({ ok: false, code }, { status, headers: { 'Cache-Control': 'no-store' } });

/** Serves the ingest log as `write-financial-gmail-log-<today>.csv`. */
export async function serveGmailLog({ context }: { context: Pick<RequestContext, 'session'> }): Promise<Response> {
  let userId: string;
  try {
    const s = await services();
    userId = (await requireSession(context.session, { twoFactor: true }, s.now())).user.id;
  } catch (error) {
    if (error instanceof UnauthenticatedError) return REFUSED(401, 'UNAUTHENTICATED');
    if (error instanceof TwoFactorRequiredError) return REFUSED(403, 'TWO_FACTOR_REQUIRED');
    throw error;
  }
  const { gmail, now } = await services();
  const filename = `write-financial-gmail-log-${now().toISOString().slice(0, 10)}.csv`;
  let before: { at: Date; id: string } | undefined;
  let first = true;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const logs = await gmail.listLogs(userId, { limit: 500, ...(before === undefined ? {} : { before }) });
        if (logs.length > 0 || first) {
          const csv = gmailLogCsv(logs);
          controller.enqueue(new TextEncoder().encode(first ? csv : `\r\n${csv.slice(csv.indexOf('\r\n') + 2)}`));
        }
        first = false;
        const last = logs.at(-1);
        if (logs.length < 500 || last === undefined) controller.close();
        else before = { at: last.createdAt, id: last.id };
      } catch {
        controller.error(new Error('Gmail log unavailable'));
      }
    },
  });
  return new Response(stream, { headers: new Headers({ ...downloadHeaders('text/csv', filename) }) });
}
