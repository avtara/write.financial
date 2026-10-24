// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { serveDataExport } from '../../server/export-file.ts';

/** The signed-in user's data as a download (FR-A11): `?format=json` (default) or `?format=csv`. */
export const Route = createFileRoute('/api/data/export')({
  server: { handlers: { GET: serveDataExport } },
});
