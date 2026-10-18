// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Absolute URL of an app path under `PUBLIC_URL`, which may itself have a path (`https://host/finance`):
 * `appUrl('https://host/finance', 'sign-up?x=1')` → `https://host/finance/sign-up?x=1`.
 */
export function appUrl(publicUrl: string, path: string): string {
  const base = publicUrl.endsWith('/') ? publicUrl : `${publicUrl}/`;
  return new URL(path.replace(/^\/+/, ''), base).href;
}
