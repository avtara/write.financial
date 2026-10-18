// SPDX-License-Identifier: AGPL-3.0-only

/** Replacement for redacted values; use it as pino's `redact.censor` too. */
export const REDACTED = '[REDACTED]';

/**
 * Object keys whose values never reach logs. pino paths cannot match key suffixes, so every `_enc` column
 * (and its camelCase Drizzle field) is listed explicitly: add new ones here.
 */
const SECRET_KEYS = [
  'password',
  'passwordHash',
  'password_hash',
  'currentPassword',
  'newPassword',
  'passphrase',
  'secret',
  'clientSecret',
  'client_secret',
  'apiKey',
  'api_key',
  'apikey',
  'token',
  'tokens',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'idToken',
  'id_token',
  'sessionToken',
  'session_token',
  'authorization',
  'Authorization',
  'cookie',
  'cookies',
  'credentials',
  'totpSecret',
  'totp_secret',
  'backupCodes',
  'backup_codes',
  'privateKey',
  'private_key',
  'kek',
  'dek',
  'dekWrapped',
  'dek_wrapped',
  'note_enc',
  'noteEnc',
  'ocr_enc',
  'ocrEnc',
  'payload_enc',
  'payloadEnc',
  'counterparty_enc',
  'counterpartyEnc',
  'api_key_enc',
  'apiKeyEnc',
  'tokens_enc',
  'tokensEnc',
  'quote_enc',
  'quoteEnc',
  'extraction_enc',
  'extractionEnc',
];

/** Keys that are not JS identifiers (HTTP headers) need bracket notation in pino paths. */
const SECRET_HEADERS = ['set-cookie', 'x-api-key', 'proxy-authorization'];

/** Top level plus three levels of nesting, e.g. `req.headers.cookie`, `err.config.headers.authorization`. */
const DEPTHS = ['', '*.', '*.*.', '*.*.*.'];

/** Paths for pino `redact: { paths: REDACT_PATHS, censor: REDACTED }`. */
export const REDACT_PATHS: readonly string[] = Object.freeze(
  DEPTHS.flatMap((prefix) => [
    ...SECRET_KEYS.map((key) => `${prefix}${key}`),
    ...SECRET_HEADERS.map((key) => `${prefix.slice(0, -1)}["${key}"]`),
  ]),
);

const TOKEN_RULES: readonly (readonly [RegExp, string])[] = [
  // Authorization header values.
  [/\bBearer\s+[\w.~+/-]{8,}=*/gi, `Bearer ${REDACTED}`],
  // JWTs (header.payload.signature, header always starts with `{"` → `eyJ`).
  [/\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]*/g, REDACTED],
  // Google OAuth access tokens and refresh tokens.
  [/\bya29\.[\w-]{16,}/g, REDACTED],
  [/\b1\/\/[\w-]{16,}/g, REDACTED],
  // Provider API keys: `sk-…` (OpenAI/OpenRouter), `sk_live_…`, `pk_test_…`, `rk_…`.
  [/\b(?:sk|pk|rk)[-_][\w-]{16,}/g, REDACTED],
  // Long hex/base64 values of key/token/secret/password/signature query or form parameters.
  [/\b([\w-]*?(?:key|token|secret|password|signature))=[\w.~+/%-]{16,}=*/gi, `$1=${REDACTED}`],
];

/**
 * Card numbers: 13–19 contiguous digits, or the usual groupings (4-4-4-1..4[-3], Amex 4-6-5, Diners 4-6-4)
 * with one consistent space or dash. Not part of a longer number, word, or decimal (`1.234…`, `…,5`).
 */
const CARD =
  /(?<!\w|\d[.,])(?:\d{13,19}|\d{4}([ -])\d{4}\1\d{4}\1\d{1,4}(?:\1\d{3})?|\d{4}([ -])\d{6}\2\d{4,5})(?!\w|[.,]\d)/g;

/** Doubled Luhn digit (`2d`, minus 9 if above 9), indexed by `d`. */
const LUHN_DOUBLE = '0246813579';

function luhnValid(digits: string): boolean {
  let sum = 0;
  // Payload digits from the right (the check digit is index 0); every other one, starting with the first, doubled.
  for (let fromRight = 1; fromRight < digits.length; fromRight++) {
    const digit = Number(digits[digits.length - 1 - fromRight]);
    sum += fromRight % 2 === 1 ? Number(LUHN_DOUBLE[digit]) : digit;
  }
  return (10 - (sum % 10)) % 10 === Number(digits.at(-1));
}

function maskCard(match: string): string {
  const digits = match.replace(/\D/g, '');
  if (!luhnValid(digits)) return match;
  let toMask = digits.length - 4;
  return match.replace(/\d/g, (digit) => (toMask-- > 0 ? '*' : digit));
}

/**
 * Replaces secret-looking substrings in free text (log messages, error strings): bearer tokens, JWTs,
 * Google OAuth tokens, provider API keys, long key/token query values, and Luhn-valid card numbers
 * (masked except the last 4 digits). Amounts like `42.810.000` and dates are left alone.
 */
export function redactText(text: string): string {
  let result = text;
  for (const [pattern, replacement] of TOKEN_RULES) result = result.replace(pattern, replacement);
  return result.replace(CARD, maskCard);
}
