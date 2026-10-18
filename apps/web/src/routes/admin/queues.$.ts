// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { handleQueueBoard } from '../../server/queue-route.ts';

/** Bull Board's static assets and read-only API. */
export const Route = createFileRoute('/admin/queues/$')({
  server: { handlers: { GET: handleQueueBoard } },
});
