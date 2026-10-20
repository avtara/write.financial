// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { serveAttachmentFile } from '../../server/attachment-file.ts';

/** An attachment of the signed-in user's transaction (FR-L4): `?size=thumbnail`, `?download=1`. */
export const Route = createFileRoute('/api/transactions/$id/attachments/$attachmentId')({
  server: { handlers: { GET: serveAttachmentFile } },
});
