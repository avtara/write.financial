// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';

/** Liveness probe for Docker/Caddy: answers from the process alone, without touching Postgres, Valkey, or S3. */
export const Route = createFileRoute('/healthz')({
  server: { handlers: { GET: () => Response.json({ status: 'ok' }) } },
});
