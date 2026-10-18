// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, createNonce, securityHeaders } from './security.ts';

const NONCE = 'bm9uY2Utbm9uY2Utbm9uYw==';

function directives(policy: string): Record<string, string> {
  return Object.fromEntries(
    policy.split('; ').map((directive) => {
      const [name = '', ...values] = directive.split(' ');
      return [name, values.join(' ')];
    }),
  );
}

describe('createNonce', () => {
  it('returns 128 random bits as base64, different every time', () => {
    const nonces = new Set(Array.from({ length: 50 }, createNonce));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(Buffer.from(nonce, 'base64')).toHaveLength(16);
  });
});

describe('contentSecurityPolicy', () => {
  it('allows scripts and styles only with the nonce in production', () => {
    const policy = directives(contentSecurityPolicy({ nonce: NONCE, publicUrl: 'http://localhost:3000/', dev: false }));
    expect(policy).toEqual({
      'default-src': "'self'",
      'script-src': `'nonce-${NONCE}' 'strict-dynamic'`,
      'style-src': `'self' 'nonce-${NONCE}'`,
      'img-src': "'self' data:",
      'font-src': "'self'",
      'connect-src': "'self'",
      'object-src': "'none'",
      'base-uri': "'none'",
      'form-action': "'self'",
      'frame-ancestors': "'none'",
    });
  });

  it('lets the Vite dev server inject styles and open its WebSocket, never inline scripts', () => {
    const policy = directives(contentSecurityPolicy({ nonce: NONCE, publicUrl: 'http://localhost:3000/', dev: true }));
    expect(policy['script-src']).toBe(`'nonce-${NONCE}' 'strict-dynamic'`);
    expect(policy['style-src']).toBe("'self' 'unsafe-inline'");
    expect(policy['connect-src']).toBe("'self' ws: wss:");
  });

  it('upgrades insecure requests behind https', () => {
    const policy = contentSecurityPolicy({ nonce: NONCE, publicUrl: 'https://write.financial/', dev: false });
    expect(policy.endsWith('; upgrade-insecure-requests')).toBe(true);
  });
});

describe('securityHeaders', () => {
  it('sends the PRD §9.1 headers and forbids caching the nonce page', () => {
    const headers = new Headers(securityHeaders({ nonce: NONCE, publicUrl: 'http://localhost:3000/', dev: false }));
    expect(headers.get('content-security-policy')).toContain(`'nonce-${NONCE}'`);
    expect(headers.get('x-frame-options')).toBe('DENY');
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(headers.get('permissions-policy')).toBe(
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
    );
    expect(headers.get('cache-control')).toBe('no-store');
    expect(headers.has('strict-transport-security')).toBe(false);
  });

  it('adds HSTS only when PUBLIC_URL is https', () => {
    const headers = new Headers(securityHeaders({ nonce: NONCE, publicUrl: 'https://write.financial/', dev: false }));
    expect(headers.get('strict-transport-security')).toBe('max-age=63072000; includeSubDomains');
  });
});
