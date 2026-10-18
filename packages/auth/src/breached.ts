// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Breached-password check against Have I Been Pwned (PRD §9.1) with k-anonymity: only the first five hex
 * characters of the password's SHA-1 leave the server, and responses are padded (`Add-Padding`) so their size
 * does not hint at the result.
 *
 * Fails open: when the API is slow (timeout), down, or unreachable (air-gapped self-host), the password is
 * accepted and a warning is logged. A third-party outage must not block sign-up or password resets; the length
 * rule, Argon2id, lockout, and 2FA still apply, and the warning lets the operator notice.
 */
import { createHash } from 'node:crypto';

/** The pino-compatible subset of a logger the auth module writes to. */
export interface AuthLogger {
  info: (fields: Record<string, unknown>, message: string) => void;
  warn: (fields: Record<string, unknown>, message: string) => void;
  error: (fields: Record<string, unknown>, message: string) => void;
}

export const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';
export const HIBP_TIMEOUT_MS = 3000;

export interface BreachedPasswordOptions {
  readonly logger: AuthLogger;
  /** Defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/** `true` when the password appears in a known breach; `false` when it does not or cannot be checked. */
export type BreachedPasswordCheck = (password: string) => Promise<boolean>;

export function createBreachedPasswordCheck(options: BreachedPasswordOptions): BreachedPasswordCheck {
  const { logger, fetch: fetchFn = fetch, timeoutMs = HIBP_TIMEOUT_MS } = options;
  return async (password) => {
    const digest = createHash('sha1').update(password).digest('hex').toUpperCase();
    const suffix = `${digest.slice(5)}:`;
    try {
      const response = await fetchFn(`${HIBP_RANGE_URL}${digest.slice(0, 5)}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'write.financial' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        logger.warn({ status: response.status }, 'Breached-password check unavailable; password accepted');
        return false;
      }
      const line = (await response.text()).split(/\r?\n/).find((entry) => entry.toUpperCase().startsWith(suffix));
      return line !== undefined && Number(line.slice(suffix.length)) > 0;
    } catch (error) {
      logger.warn({ err: error }, 'Breached-password check failed; password accepted');
      return false;
    }
  };
}
