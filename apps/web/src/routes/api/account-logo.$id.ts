// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { serveAccountLogo } from '../../server/account-logo.ts';

/** An uploaded account logo of the signed-in user (FR-R1). */
export const Route = createFileRoute('/api/account-logo/$id')({
  server: { handlers: { GET: serveAccountLogo } },
});
