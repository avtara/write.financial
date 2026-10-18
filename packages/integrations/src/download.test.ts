// SPDX-License-Identifier: AGPL-3.0-only
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { downloadHeaders } from './download.ts';

const disposition = (filename: string, mime = 'application/pdf') =>
  downloadHeaders(mime, filename)['Content-Disposition'];

describe('downloadHeaders', () => {
  it('serves re-encoded raster images inline with private, no-store, nosniff, and a sandbox CSP', () => {
    expect(downloadHeaders('image/webp', 'struk.webp')).toEqual({
      'Content-Type': 'image/webp',
      'Content-Disposition': `inline; filename="struk.webp"; filename*=UTF-8''struk.webp`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    expect(disposition('a.jpg', 'image/jpeg')).toMatch(/^inline;/);
    expect(disposition('a.png', 'image/png')).toMatch(/^inline;/);
  });

  it('downloads every other type as an attachment, including scriptable SVG and HTML', () => {
    for (const mime of ['application/pdf', 'image/svg+xml', 'text/html', 'image/gif']) {
      const headers = downloadHeaders(mime, 'file');
      expect(headers['Content-Type']).toBe(mime);
      expect(headers['Content-Disposition']).toMatch(/^attachment;/);
    }
  });

  it('falls back to application/octet-stream for a malformed media type', () => {
    for (const mime of ['text/html; charset=utf-8', 'IMAGE/PNG', 'image/png\r\nX-Evil: 1', '']) {
      const headers = downloadHeaders(mime, 'x');
      expect(headers['Content-Type']).toBe('application/octet-stream');
      expect(headers['Content-Disposition']).toMatch(/^attachment;/);
    }
  });

  it('encodes non-ASCII names per RFC 5987 with an ASCII fallback', () => {
    expect(disposition("Struk Café (Mei)'s *final*.pdf")).toBe(
      `attachment; filename="Struk Caf_ (Mei)'s *final*.pdf"; ` +
        `filename*=UTF-8''Struk%20Caf%C3%A9%20%28Mei%29%27s%20%2Afinal%2A.pdf`,
    );
    expect(disposition('laporan-₹-日本.xlsx')).toBe(
      `attachment; filename="laporan-_-__.xlsx"; filename*=UTF-8''laporan-%E2%82%B9-%E6%97%A5%E6%9C%AC.xlsx`,
    );
  });

  it('normalizes to NFC', () => {
    expect(disposition('cafe\u0301.pdf')).toBe(disposition('caf\u00e9.pdf'));
  });

  it('replaces quotes, backslashes, and percent signs in the fallback so it cannot be re-decoded', () => {
    expect(disposition('a"b%41c.pdf')).toBe(`attachment; filename="a_b_41c.pdf"; filename*=UTF-8''a%22b%2541c.pdf`);
  });

  it('removes control characters, path separators, and bidi overrides', () => {
    expect(disposition('a\r\nSet-Cookie: x=1.pdf')).toContain('filename="aSet-Cookie: x=1.pdf"');
    expect(disposition('../..\\etc/passwd')).toContain('filename="....etcpasswd"');
    expect(disposition('invoice\u202efdp.exe')).toContain('filename="invoicefdp.exe"');
    expect(disposition('a\u2066b\u0085c\u007f.pdf')).toContain('filename="abc.pdf"');
  });

  it('uses "download" when nothing of the name is left', () => {
    for (const filename of ['', '   ', '\u0000\u202e/']) {
      expect(disposition(filename)).toBe(`attachment; filename="download"; filename*=UTF-8''download`);
    }
  });

  it('truncates to 200 characters without leaving a broken surrogate pair', () => {
    expect(disposition('a'.repeat(300))).toContain(`filename="${'a'.repeat(200)}"`);
    expect(disposition(`${'a'.repeat(199)}😀`)).toContain(`filename*=UTF-8''${'a'.repeat(199)}%EF%BF%BD`);
    expect(disposition('x\ud800y')).toContain(`filename*=UTF-8''x%EF%BF%BDy`);
  });

  it('never emits header-breaking characters, and filename* decodes to the fallback for ASCII names', () => {
    // Not `fc.string({ unit: 'binary' })`: its first use builds a reverse map over all 1.1M code points (~0.4 s idle,
    // over the 5 s test timeout on a loaded `pnpm check`). Plain `.map` needs no reverse map; the mix keeps the
    // characters the sanitizer cares about frequent: ASCII incl. controls and `"%\/`, C1 controls, bidi overrides,
    // lone surrogates (`fromCodePoint` accepts them), and astral code points. `size: 'large'` reaches the 200 cap.
    const codePoint = fc.oneof(
      fc.integer({ min: 0, max: 0x7f }),
      fc.constantFrom(0x85, 0x9f, 0xa0, 0x202a, 0x202e, 0x2066, 0x2069, 0x3000, 0xfeff, 0xd800, 0xdfff),
      fc.integer({ min: 0x80, max: 0xffff }),
      fc.integer({ min: 0x10000, max: 0x10ffff }),
    );
    const filenames = fc
      .array(codePoint, { maxLength: 260, size: 'large' })
      .map((points) => String.fromCodePoint(...points));
    fc.assert(
      fc.property(filenames, (filename) => {
        const value = disposition(filename);
        expect(value).toMatch(
          /^attachment; filename="[\x20-\x21\x23-\x24\x26-\x5b\x5d-\x7e]+"; filename\*=UTF-8''[\w!#$&+.^`|~%-]+$/,
        );
        const encoded = value.slice(value.indexOf("UTF-8''") + 7);
        const fallback = /filename="([^"]*)"/.exec(value)?.[1];
        const decoded = decodeURIComponent(encoded);
        expect(decoded.length).toBeLessThanOrEqual(200);
        if (/^[\x20-\x7e]*$/.test(decoded) && !/["%]/.test(decoded)) expect(fallback).toBe(decoded);
      }),
    );
  });
});
