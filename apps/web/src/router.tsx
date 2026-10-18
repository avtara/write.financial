// SPDX-License-Identifier: AGPL-3.0-only
import { createRouter } from '@tanstack/react-router';
import { getGlobalStartContext } from '@tanstack/react-start';
import { setNonce } from 'get-nonce';
import { routeTree } from './generated/routeTree.gen.ts';

/**
 * Start calls this once per request on the server (after the request middleware, so the nonce is in the
 * Start context) and once in the browser, where the router reads the nonce back from
 * `<meta property="csp-nonce">` for assets it inserts later. In the browser the same nonce also goes to `get-nonce`,
 * which Radix modal dialogs read for the scroll-lock `<style>` they insert (CSP `style-src` with a nonce).
 */
export function getRouter() {
  const start = getGlobalStartContext();
  if (start === undefined) {
    const nonce = document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')?.content;
    if (nonce !== undefined) setNonce(nonce);
  }
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    ...(start === undefined ? {} : { ssr: { nonce: start.nonce } }),
  });
}
