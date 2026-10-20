// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /api/transactions/$id/attachments/$attachmentId` (FR-L4): an attachment of the signed-in user's transaction,
 * decrypted from the attachments bucket. `?size=thumbnail` serves the thumbnail (the full file when there is none),
 * `?download=1` asks the browser to save it; PDFs are always downloads. Another user's transaction, an unknown
 * attachment, a missing object, and signed-out requests all answer 404, so the response never reveals whether an id
 * exists. Object keys never change, so a served file may be cached for good; `sandbox` keeps an opened file from
 * running anything.
 */
import { LedgerError } from '@wf/db/ledger-errors';
import { ObjectNotFoundError } from '@wf/integrations/objectstore';
import * as z from 'zod';
import type { RequestContext } from './request-middleware.ts';
import { services } from './runtime.ts';

const NOT_FOUND = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });

const PARAMS = z.object({ id: z.uuid(), attachmentId: z.uuid() });

/** `attachment; filename*=UTF-8''…` (RFC 6266/8187); without a stored name just `attachment`. */
function contentDisposition(name: string | null): string {
  if (name === null) return 'attachment';
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename*=UTF-8''${encoded}`;
}

export async function serveAttachmentFile({
  context,
  params,
  request,
}: {
  context: Pick<RequestContext, 'session'>;
  params: { id: string; attachmentId: string };
  request: Request;
}): Promise<Response> {
  const ids = PARAMS.safeParse(params);
  const session = await context.session();
  if (!ids.success || session === null) return NOT_FOUND();
  const userId = session.user.id;
  const { transactions, attachmentStore } = await services();
  let attachments;
  try {
    ({ attachments } = await transactions.get(userId, ids.data.id));
  } catch (error) {
    if (error instanceof LedgerError) return NOT_FOUND();
    throw error;
  }
  const attachment = attachments.find((candidate) => candidate.id === ids.data.attachmentId);
  if (attachment === undefined) return NOT_FOUND();
  const search = new URL(request.url).searchParams;
  const thumbnailKey = search.get('size') === 'thumbnail' ? attachment.thumbnailKey : null;
  let content;
  try {
    // Only the full object's SHA-256 is stored.
    content =
      thumbnailKey === null
        ? await attachmentStore.get(userId, attachment.objectKey, attachment.sha256)
        : await attachmentStore.get(userId, thumbnailKey);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) return NOT_FOUND();
    throw error;
  }
  const headers = new Headers({
    'Content-Type': content.mime,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
  });
  if (search.get('download') === '1' || content.mime === 'application/pdf') {
    headers.set('Content-Disposition', contentDisposition(attachment.name));
  }
  // A copy backed by a plain `ArrayBuffer`, as `Response` takes.
  return new Response(content.bytes.slice(), { headers });
}
