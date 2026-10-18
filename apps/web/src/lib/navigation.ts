// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Navigation helpers for the auth flows. After a sign-in, sign-out, or 2FA change the browser loads the next page
 * from scratch, so the server renders it with the new session (language, guards, user menu) and nothing of the
 * previous user stays in memory.
 */

/**
 * A `?redirect=` value that is safe to follow: a path on this site (`/settings/security?x=1`), never another origin
 * (`https://evil.example`, `//evil.example`, `/\evil.example`); anything else becomes `fallback`.
 */
export function safeRedirect(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return fallback;
  }
  return value;
}

/** Full page load of `path` (see the module comment). */
export function hardNavigate(path: string): void {
  window.location.assign(path);
}
