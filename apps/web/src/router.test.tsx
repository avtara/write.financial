// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';

const start = vi.hoisted(() => ({ context: undefined as { nonce: string } | undefined }));
vi.mock('@tanstack/react-start', () => ({ getGlobalStartContext: () => start.context }));
vi.mock('./server/get-preferences.ts', () => ({ getPreferences: vi.fn() }));

const { getRouter } = await import('./router.tsx');

describe('getRouter', () => {
  it('stamps the request nonce on everything the server renders', () => {
    start.context = { nonce: 'request-nonce' };
    expect(getRouter().options.ssr).toEqual({ nonce: 'request-nonce' });
  });

  it('has no Start context in the browser, where the nonce comes from <meta property="csp-nonce">', () => {
    start.context = undefined;
    expect(getRouter().options.ssr).toBeUndefined();
  });

  it('serves the generated route tree', () => {
    const router = getRouter();
    expect(Object.keys(router.routesByPath).sort()).toEqual(['/', '/healthz']);
  });
});
