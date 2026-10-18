// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { handleQueueBoard } from '../../server/queue-route.ts';

/** Bull Board's entry page (admins with 2FA and a fresh session); its assets and API live below `queues.$.ts`. */
export const Route = createFileRoute('/admin/queues')({
  server: { handlers: { GET: handleQueueBoard } },
});
