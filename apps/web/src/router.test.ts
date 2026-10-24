// SPDX-License-Identifier: AGPL-3.0-only
import * as reactRouter from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRouter } from './router.tsx';

const start = vi.hoisted(() => ({ context: undefined as { nonce: string } | undefined }));
vi.mock('@tanstack/react-start', async (original) => ({
  ...(await original<object>()),
  getGlobalStartContext: () => start.context,
}));
vi.mock('@tanstack/react-router', async (original) => {
  const actual = await original<typeof reactRouter>();
  return { ...actual, createRouter: vi.fn(actual.createRouter) };
});
const nonces = vi.hoisted(() => ({ setNonce: vi.fn() }));
vi.mock('get-nonce', async (original) => ({ ...(await original<object>()), setNonce: nonces.setNonce }));

/**
 * The browser: no Start context, and a page whose `<meta property="csp-nonce">` holds `nonce` (none when `null`).
 * Node has no browser history, so the router itself is not built.
 */
function inBrowser(nonce: string | null) {
  start.context = undefined;
  vi.stubGlobal('document', {
    querySelector: (selector: string) =>
      selector === 'meta[property="csp-nonce"]' && nonce !== null ? { content: nonce } : null,
  });
  vi.mocked(reactRouter.createRouter).mockReturnValueOnce({} as never);
}

afterEach(() => {
  vi.unstubAllGlobals();
  nonces.setNonce.mockClear();
});

describe('getRouter', () => {
  it('stamps the request nonce on everything the server renders', () => {
    start.context = { nonce: 'request-nonce' };
    expect(getRouter().options.ssr).toEqual({ nonce: 'request-nonce' });
    expect(nonces.setNonce).not.toHaveBeenCalled();
  });

  it('has no Start context in the browser, where the nonce comes from <meta property="csp-nonce">', () => {
    inBrowser('page-nonce');
    getRouter();
    expect(vi.mocked(reactRouter.createRouter).mock.lastCall?.[0]).not.toHaveProperty('ssr');
    // Radix modal dialogs read it (through get-nonce) for the scroll-lock <style> they insert.
    expect(nonces.setNonce).toHaveBeenCalledWith('page-nonce');
  });

  it('sets no nonce when the page has none', () => {
    inBrowser(null);
    getRouter();
    expect(nonces.setNonce).not.toHaveBeenCalled();
  });

  it('serves the generated route tree', () => {
    start.context = { nonce: 'request-nonce' };
    expect(Object.keys(getRouter().routesByPath).sort()).toEqual([
      '/',
      '/2fa',
      '/accounts',
      '/admin/queues',
      '/admin/queues/$',
      '/api/account-logo/$id',
      '/api/auth/$',
      '/api/reports/$fileId',
      '/api/subscription-logo/$id',
      '/api/transactions/$id/attachments/$attachmentId',
      '/budget',
      '/calendar',
      '/debts',
      '/forgot',
      '/goals',
      '/healthz',
      '/investments',
      '/notifications',
      '/onboarding/$step',
      '/reports',
      '/reset-password',
      '/review',
      '/settings/$section',
      '/setup',
      '/sign-in',
      '/sign-up',
      '/subscriptions',
      '/transactions',
      '/two-factor-setup',
    ]);
  });
});
