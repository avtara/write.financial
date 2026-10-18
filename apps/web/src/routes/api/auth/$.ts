// SPDX-License-Identifier: AGPL-3.0-only
import { createFileRoute } from '@tanstack/react-router';
import { handleAuthRequest } from '../../../server/auth-handler.ts';
import { services } from '../../../server/runtime.ts';

/** Better Auth (`@wf/auth`) for every method; the request middleware still adds the security headers. */
const handle = async ({ request }: { request: Request }) => handleAuthRequest((await services()).auth, request);

export const Route = createFileRoute('/api/auth/$')({
  server: { handlers: { GET: handle, POST: handle } },
});
