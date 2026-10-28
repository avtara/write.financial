// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_LOCK_COOKIE_NAME, hasAppLockHint, writeAppLockHint } from './app-lock-hint.ts';

/** A browser page on `protocol` (cookie writes replace the jar whole, enough for one cookie). */
function inBrowser(protocol = 'http:') {
  const document = { cookie: '' };
  vi.stubGlobal('document', document);
  vi.stubGlobal('location', { protocol });
  return document;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the app lock hint cookie', () => {
  it('is read from a Cookie header', () => {
    expect(hasAppLockHint(`wf_theme=dark; ${APP_LOCK_COOKIE_NAME}=on`)).toBe(true);
    expect(hasAppLockHint(`${APP_LOCK_COOKIE_NAME}=off`)).toBe(false);
    expect(hasAppLockHint('')).toBe(false);
  });

  it('is set for 400 days and cleared again, Secure on https', () => {
    const page = inBrowser();
    writeAppLockHint(true);
    expect(page.cookie).toBe(`${APP_LOCK_COOKIE_NAME}=on; Path=/; Max-Age=34560000; SameSite=Lax`);
    writeAppLockHint(false);
    expect(page.cookie).toBe(`${APP_LOCK_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`);
    const secure = inBrowser('https:');
    writeAppLockHint(true);
    expect(secure.cookie).toBe(`${APP_LOCK_COOKIE_NAME}=on; Path=/; Max-Age=34560000; SameSite=Lax; Secure`);
    writeAppLockHint(false);
    expect(secure.cookie).toBe(`${APP_LOCK_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax; Secure`);
  });
});
