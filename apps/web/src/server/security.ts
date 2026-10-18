// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Response security headers for the web application (PRD §9.1 "Web application").
 *
 * Scripts run only with the per-request nonce: TanStack Start stamps it on every script and preload it
 * renders (`router.options.ssr.nonce`) and exposes it to the client in `<meta property="csp-nonce">`, so
 * client-inserted assets carry it too. `'strict-dynamic'` lets those trusted scripts load the route chunks
 * they import. No `'unsafe-inline'`, no `'unsafe-eval'` for scripts.
 */
import { randomBytes } from 'node:crypto';

/** 128 bits from the CSPRNG, base64 (CSP3 `nonce-source`). */
export function createNonce(): string {
  return randomBytes(16).toString('base64');
}

export interface SecurityHeaderOptions {
  readonly nonce: string;
  /** `PUBLIC_URL`; HSTS and `upgrade-insecure-requests` are only sent when it is `https:`. */
  readonly publicUrl: string;
  /**
   * Vite dev server: it injects CSS through `<style>` elements without a nonce and talks to the browser
   * over a WebSocket, so dev allows inline styles and `ws:`. Production never sets this.
   */
  readonly dev: boolean;
  /**
   * Bull Board's page (`queue-board.ts`), the only exception to the policy, and only on {@link QUEUE_BOARD_PATH}:
   * - `base-uri 'self'`: its client reads its API base from a same-origin `<base href>`;
   * - `style-src 'self' 'unsafe-inline'`: its bundled React UI inserts `<style>` elements and `style` attributes
   *   without the nonce. Styles cannot run script; scripts still need the nonce.
   */
  readonly queueBoard?: boolean;
}

/** Bull Board (admin, read-only); the only path served with {@link SecurityHeaderOptions.queueBoard}. */
export const QUEUE_BOARD_PATH = '/admin/queues';

/** Two years, the HSTS preload list minimum. */
const HSTS_MAX_AGE = 63_072_000;

export function contentSecurityPolicy({ nonce, publicUrl, dev, queueBoard = false }: SecurityHeaderOptions): string {
  const directives = [
    "default-src 'self'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    dev || queueBoard ? "style-src 'self' 'unsafe-inline'" : `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    dev ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
    "object-src 'none'",
    queueBoard ? "base-uri 'self'" : "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (new URL(publicUrl).protocol === 'https:') directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

/** Headers for every response the Start handler produces (pages, server routes, server functions). */
export function securityHeaders(options: SecurityHeaderOptions): [name: string, value: string][] {
  const headers: [string, string][] = [
    ['Content-Security-Policy', contentSecurityPolicy(options)],
    ['X-Frame-Options', 'DENY'],
    ['X-Content-Type-Options', 'nosniff'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()'],
    // The nonce is single-use and pages show private data: never store them in shared or back/forward caches.
    ['Cache-Control', 'no-store'],
  ];
  if (new URL(options.publicUrl).protocol === 'https:') {
    headers.push(['Strict-Transport-Security', `max-age=${HSTS_MAX_AGE}; includeSubDomains`]);
  }
  return headers;
}
