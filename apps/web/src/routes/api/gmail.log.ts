// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { serveGmailLog } from '../../server/gmail-log-file.ts';

/** The signed-in user's email ingest log as a CSV download (FR-AI4). */
export const Route = createFileRoute('/api/gmail/log')({
  server: { handlers: { GET: serveGmailLog } },
});
