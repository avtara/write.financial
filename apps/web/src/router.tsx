// SPDX-License-Identifier: AGPL-3.0-only
import { createRouter } from '@tanstack/react-router';
import { getGlobalStartContext } from '@tanstack/react-start';
import { routeTree } from './generated/routeTree.gen.ts';

/**
 * Start calls this once per request on the server (after the request middleware, so the nonce is in the
 * Start context) and once in the browser, where the router reads the nonce back from
 * `<meta property="csp-nonce">` for assets it inserts later.
 */
export function getRouter() {
  const start = getGlobalStartContext();
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    ...(start === undefined ? {} : { ssr: { nonce: start.nonce } }),
  });
}
