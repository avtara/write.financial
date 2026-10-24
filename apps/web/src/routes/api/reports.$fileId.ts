// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { serveReportFile } from '../../server/report-file.ts';

/** `GET /api/reports/$fileId`: the signed-in user's stored export (FR-LP4), served as a download. */
export const Route = createFileRoute('/api/reports/$fileId')({
  server: { handlers: { GET: serveReportFile } },
});
