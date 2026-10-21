// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { serveSubscriptionLogo } from '../../server/logos.ts';

/** An uploaded subscription logo of the signed-in user (FR-SUB1). */
export const Route = createFileRoute('/api/subscription-logo/$id')({
  server: { handlers: { GET: serveSubscriptionLogo } },
});
