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
  // Whether the navigation being rendered stays on the same page (only the search changed: a filter, a period, a tab,
  // `?settings=`, or a reload of the data). Per router: the server builds one per request.
  let samePage = false;
  const router = createRouter({
    routeTree,
    // A new page starts at the top (or where Back left it); changing a filter keeps the scroll where it is, instead of
    // jumping to the top under the reader's eyes (TanStack resets it on every navigation by default).
    scrollRestoration: () => !samePage,
    defaultPreload: 'intent',
    ...(start === undefined ? {} : { ssr: { nonce: start.nonce } }),
  });
  // The control the change came from (the focused link, tab, or button) and where it was on screen: content above it
  // that grows or shrinks with the new filter (another week's money flow, say) must not slide it away.
  let anchor: { readonly element: Element; readonly top: number } | null = null;
  router.subscribe('onBeforeLoad', (event) => {
    samePage = event.fromLocation !== undefined && !event.pathChanged;
    if (typeof document === 'undefined') return;
    const element = document.activeElement;
    anchor =
      samePage && element !== null && element !== document.body
        ? { element, top: element.getBoundingClientRect().top }
        : null;
  });
  router.subscribe('onRendered', () => {
    if (anchor?.element.isConnected === true) {
      const shift = anchor.element.getBoundingClientRect().top - anchor.top;
      if (Math.abs(shift) >= 1) window.scrollBy({ top: shift, behavior: 'instant' });
    }
    anchor = null;
  });
  return router;
}
