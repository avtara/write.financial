// SPDX-License-Identifier: AGPL-3.0-only
import { createCsrfMiddleware, createStart } from '@tanstack/react-start';
import { requestMiddleware } from './server/request-middleware.ts';

/**
 * CSRF (PRD §9.1): server functions are same-origin RPC; a request whose `Sec-Fetch-Site` (or, from older browsers,
 * `Origin`/`Referer`) is not same-origin is refused with 403 before any handler runs. Together with `SameSite=Lax`
 * session cookies this protects every mutation. `/api/auth/*` has Better Auth's own origin check.
 */
export const csrfMiddleware = createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === 'serverFn' });

export const startInstance = createStart(() => ({ requestMiddleware: [csrfMiddleware, requestMiddleware] }));
