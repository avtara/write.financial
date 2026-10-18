// SPDX-License-Identifier: AGPL-3.0-only
import { MEDIA_TYPE } from './mime.ts';

/**
 * Response headers for serving a decrypted user file (PRD §9.1). Only re-encoded raster images are shown inline;
 * everything else downloads as an attachment. Either way the response cannot run script or be sniffed into HTML
 * (`nosniff`, CSP `default-src 'none'; sandbox`), is never cached by the browser or a proxy, and cannot be embedded
 * by other sites.
 */

export interface DownloadHeaders {
  readonly 'Content-Type': string;
  readonly 'Content-Disposition': string;
  readonly 'Cache-Control': 'private, no-store';
  readonly 'X-Content-Type-Options': 'nosniff';
  readonly 'Content-Security-Policy': "default-src 'none'; sandbox";
  readonly 'Cross-Origin-Resource-Policy': 'same-origin';
}

const INLINE_TYPES: Readonly<Record<string, true>> = { 'image/jpeg': true, 'image/png': true, 'image/webp': true };
const MAX_FILENAME_LENGTH = 200;

/**
 * Control characters (`\p{Cc}`), path separators, and bidi controls (U+202A–U+202E, U+2066–U+2069) that could
 * disguise an extension, e.g. `invoice\u202Efdp.exe` rendered as `invoiceexe.pdf`.
 */
const UNSAFE_FILENAME = /[\p{Cc}/\\\u202a-\u202e\u2066-\u2069]/gu;

/** RFC 5987 `value-chars`: `encodeURIComponent` also leaves `'()*` unescaped, which are not `attr-char`s. */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * `mime` is the stored media type (invalid values fall back to `application/octet-stream`); `filename` is the
 * user's original name, sanitized and sent both as an ASCII fallback and as UTF-8 `filename*`.
 */
export function downloadHeaders(mime: string, filename: string): DownloadHeaders {
  const contentType = MEDIA_TYPE.test(mime) ? mime : 'application/octet-stream';
  // Truncating can split a surrogate pair; `toWellFormed` afterwards keeps `encodeURIComponent` from throwing.
  const name =
    filename.normalize('NFC').replace(UNSAFE_FILENAME, '').trim().slice(0, MAX_FILENAME_LENGTH).toWellFormed() ||
    'download';
  const ascii = name.replace(/[^\x20-\x7e]|["%\\]/g, '_');
  const disposition = INLINE_TYPES[contentType] === true ? 'inline' : 'attachment';
  return {
    'Content-Type': contentType,
    'Content-Disposition': `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(name)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
}
