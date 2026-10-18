// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Better Auth HTTP handler as mounted at `/api/auth/*` (`routes/api/auth/$.ts`), with the instance's rules for
 * the endpoints that change how an account is protected (FR-A9):
 * - they need a fresh session (signed in at most 15 minutes ago); otherwise the answer is 403
 *   `REAUTHENTICATION_REQUIRED` and the client asks the user to sign in again;
 * - an admin cannot turn two-step verification off (`ADMIN_TWO_FACTOR_REQUIRED`): it is mandatory for admins.
 * Better Auth itself checks the request origin (CSRF) and the password where an endpoint needs one.
 */
import type { WfAuth } from '@wf/auth/auth';
import { ReauthenticationRequiredError, UnauthenticatedError } from '@wf/auth/session';

/** Paths below the auth base path that need a fresh session. */
export const FRESH_SESSION_PATHS: readonly string[] = [
  '/two-factor/enable',
  '/two-factor/disable',
  '/two-factor/generate-backup-codes',
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
  '/passkey/delete-passkey',
  '/change-password',
];

const refuse = (status: number, code: string, message: string) => Response.json({ code, message }, { status });

export async function handleAuthRequest(
  auth: Pick<WfAuth, 'handler' | 'basePath' | 'requireFreshSession'>,
  request: Request,
): Promise<Response> {
  const path = new URL(request.url).pathname.slice(auth.basePath.length);
  if (FRESH_SESSION_PATHS.includes(path)) {
    try {
      const { user } = await auth.requireFreshSession(request.headers);
      if (path === '/two-factor/disable' && user.role === 'admin') {
        return refuse(403, 'ADMIN_TWO_FACTOR_REQUIRED', 'Two-step verification is mandatory for admins');
      }
    } catch (error) {
      if (error instanceof UnauthenticatedError) return refuse(401, error.code, error.message);
      if (error instanceof ReauthenticationRequiredError) return refuse(403, error.code, error.message);
      throw error;
    }
  }
  return auth.handler(request);
}
