// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tells the server render that this browser has an app lock PIN (FR-A6), so a page loaded while it may be locked is
 * rendered without the app content until the browser has checked the PIN record in IndexedDB. Only a flag: the PIN
 * hash, the timeout, and whose PIN it is stay in IndexedDB (D11).
 */
import { parseCookies, preferenceCookie } from './preferences.ts';

export const APP_LOCK_COOKIE_NAME = 'wf_app_lock';
const ON = 'on';

/** Whether a `Cookie` header (or `document.cookie`) says this browser has a PIN. */
export function hasAppLockHint(cookies: string): boolean {
  return parseCookies(cookies).get(APP_LOCK_COOKIE_NAME) === ON;
}

export function writeAppLockHint(present: boolean): void {
  const secure = location.protocol === 'https:';
  document.cookie = present
    ? preferenceCookie(APP_LOCK_COOKIE_NAME, ON, secure)
    : `${APP_LOCK_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax${secure ? '; Secure' : ''}`;
}
