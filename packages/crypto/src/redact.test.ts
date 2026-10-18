// SPDX-License-Identifier: AGPL-3.0-only
import { Writable } from 'node:stream';
import fc from 'fast-check';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACTED, REDACT_PATHS, redactText } from './redact.ts';

const SENTINEL = 'sentinel-value-must-not-be-logged';

/** Independent copy of the keys that must never be logged (do not derive it from the implementation). */
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
  'set-cookie',
  'x-api-key',
  'proxy-authorization',
];

function logLine(object: Record<string, unknown>): string {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  pino({ redact: { paths: [...REDACT_PATHS], censor: REDACTED } }, stream).info(object);
  return lines.join('');
}

function nest(depth: number, leaf: Record<string, unknown>): Record<string, unknown> {
  let object = leaf;
  for (let level = 0; level < depth; level++) object = { [`level${level}`]: object };
  return object;
}

describe('REDACT_PATHS', () => {
  it('uses a visible censor', () => {
    expect(REDACTED).toBe('[REDACTED]');
  });

  it('includes the documented top-level and wildcard paths and is frozen', () => {
    expect(REDACT_PATHS).toEqual(
      expect.arrayContaining(['password', '*.password', '*.*.password', 'apiKey', '*.note_enc', '["set-cookie"]']),
    );
    expect(REDACT_PATHS).toContain('*.*["set-cookie"]');
    expect(Object.isFrozen(REDACT_PATHS)).toBe(true);
  });

  it.each([0, 1, 2, 3])('makes pino censor every secret key at depth %i', (depth) => {
    const leaf = Object.fromEntries(SECRET_KEYS.map((key) => [key, SENTINEL]));
    const logged = JSON.parse(logLine(nest(depth, leaf))) as Record<string, unknown>;
    let object = logged;
    for (let level = depth - 1; level >= 0; level--) object = object[`level${level}`] as Record<string, unknown>;
    expect(Object.fromEntries(SECRET_KEYS.map((key) => [key, object[key]]))).toEqual(
      Object.fromEntries(SECRET_KEYS.map((key) => [key, REDACTED])),
    );
  });

  it('censors typical request and error shapes', () => {
    const line = logLine({
      req: { headers: { authorization: SENTINEL, cookie: SENTINEL, host: 'app.write.financial' } },
      res: { headers: { 'set-cookie': SENTINEL } },
      err: { config: { headers: { Authorization: SENTINEL } } },
      users: [{ password: SENTINEL }],
    });
    expect(line).not.toContain(SENTINEL);
    expect(line).toContain('app.write.financial');
  });

  it('leaves ordinary fields alone', () => {
    const line = logLine({ userId: 'u1', amountMinor: '42810000', merchant: 'Indomaret', passwordChanged: true });
    expect(JSON.parse(line)).toMatchObject({
      userId: 'u1',
      amountMinor: '42810000',
      merchant: 'Indomaret',
      passwordChanged: true,
    });
  });
});

const b64url = (text: string) => Buffer.from(text).toString('base64url');
const jwt = [b64url('{"alg":"HS256","typ":"JWT"}'), b64url('{"sub":"u1","exp":1}'), 'c2lnbmF0dXJlLWJ5dGVz'].join('.');
const longHex = 'a1b2c3d4'.repeat(5);

describe('redactText — tokens and keys', () => {
  it.each([
    ['Bearer header', `Authorization: Bearer ${'Ab9-'.repeat(8)}`, `Authorization: Bearer ${REDACTED}`],
    ['lowercase bearer', `bearer ${'q'.repeat(20)} sent`, `Bearer ${REDACTED} sent`],
    ['bearer padding and symbols', 'Bearer a.b~c+d/e-f_g==', `Bearer ${REDACTED}`],
    ['bearer after several spaces', `Bearer \t ${'z'.repeat(8)}`, `Bearer ${REDACTED}`],
    ['bearer of exactly 8 chars', 'Bearer abcdefgh', `Bearer ${REDACTED}`],
    ['JWT', `session ${jwt} expired`, `session ${REDACTED} expired`],
    ['unsigned JWT', `${jwt.slice(0, jwt.lastIndexOf('.') + 1)} end`, `${REDACTED} end`],
    ['Google access token', `token=ya29.${'a0AfH6-_'.repeat(4)}`, `token=${REDACTED}`],
    ['Google access token, 16 chars', `t ya29.${'x'.repeat(16)}`, `t ${REDACTED}`],
    ['Google refresh token', `refresh 1//0g${'Lw-_'.repeat(8)}.`, `refresh ${REDACTED}.`],
    ['Google refresh token, 16 chars', `r 1//${'y'.repeat(16)}`, `r ${REDACTED}`],
    ['OpenAI key', `key sk-proj-${'Xy7_'.repeat(8)} used`, `key ${REDACTED} used`],
    ['OpenRouter key', `sk-or-v1-${longHex}`, REDACTED],
    ['Stripe-style secret key', `sk_live_${'4eC3'.repeat(6)}`, REDACTED],
    ['publishable key, 16 chars', `pk_test_${'k'.repeat(11)}`, REDACTED],
    ['restricted key', `rk-${'r'.repeat(16)}`, REDACTED],
    ['api_key query param', `GET /v1?api_key=${longHex}&page=2`, `GET /v1?api_key=${REDACTED}&page=2`],
    ['access_token param', `?access_token=${'Zm9v'.repeat(5)}%3D#x`, `?access_token=${REDACTED}#x`],
    ['uppercase TOKEN param', `&TOKEN=${'f'.repeat(16)}`, `&TOKEN=${REDACTED}`],
    ['client-secret form field', `client-secret=${'s'.repeat(16)} `, `client-secret=${REDACTED} `],
    ['password field', `password=${'p'.repeat(20)}`, `password=${REDACTED}`],
    ['signature param with padding', `signature=${'Qk'.repeat(8)}==`, `signature=${REDACTED}`],
    ['key with url-safe symbols', `key=${'a.b~c+d/e%f-g_'.repeat(2)}`, `key=${REDACTED}`],
  ])('redacts %s', (_, input, expected) => {
    expect(redactText(input)).toBe(expected);
  });

  it.each([
    ['the word bearer', 'Bearer tokens expire after 7 days'],
    ['a 7-char bearer value', 'Bearer abcdefg'],
    ['bearer inside a word', `subearer ${'q'.repeat(20)}`],
    ['two-segment eyJ string', 'eyJhbGciOi.eyJzdWIiOi'],
    ['short eyJ segments', 'eyJabc.eyJabc.sig'],
    ['short ya29 token', `ya29.${'x'.repeat(15)}`],
    ['ya29 inside a word', `aya29.${'x'.repeat(20)}`],
    ['short 1// token', `1//${'y'.repeat(15)}`],
    ['URL with port and path', 'http://10.0.0.1//static/app.js'],
    ['ordinary hyphenated words', 'task-force-alpha-bravo-charlie and risk-free-investment-plan'],
    ['short sk- id', `sk-${'k'.repeat(15)}`],
    ['other prefixes', `xk-${'k'.repeat(20)} sk.${'k'.repeat(20)}`],
    ['short key param', 'sort_key=created_at&key=short&page_token=abc'],
    ['param name not ending in a secret word', `keyword=${'w'.repeat(20)}&tokens_left=${'9'.repeat(20)}`],
    ['empty text', ''],
  ])('leaves %s alone', (_, input) => {
    expect(redactText(input)).toBe(input);
  });

  it('redacts several secrets in one text', () => {
    expect(redactText(`a Bearer ${'t'.repeat(10)} b ${jwt} c sk-${'k'.repeat(16)}`)).toBe(
      `a Bearer ${REDACTED} b ${REDACTED} c ${REDACTED}`,
    );
  });
});

/** Appends the Luhn check digit (independent implementation: doubling with `digit > 9 → −9`). */
function withCheckDigit(body: string): string {
  let sum = 0;
  for (let fromRight = 0; fromRight < body.length; fromRight++) {
    const digit = Number(body.charAt(body.length - 1 - fromRight)) * (fromRight % 2 === 0 ? 2 : 1);
    sum += digit > 9 ? digit - 9 : digit;
  }
  return `${body}${(10 - (sum % 10)) % 10}`;
}

describe('redactText — card numbers', () => {
  it.each([
    ['contiguous Visa', '4111111111111111', '************1111'],
    ['spaced Visa', 'kartu 4111 1111 1111 1111 ok', 'kartu **** **** **** 1111 ok'],
    ['dashed Mastercard', '5555-5555-5555-4444', '****-****-****-4444'],
    ['check digit 0', '5105105105105100', '************5100'],
    ['Amex 4-6-5', '3782 822463 10005', '**** ****** *0005'],
    ['Diners 4-6-4', '3056-930902-5904', '****-******-5904'],
    ['13 digits', '4222222222222', '*********2222'],
    ['contiguous 15 digits', '378282246310005', '***********0005'],
    ['Discover at end of sentence', 'paid with 6011111111111117.', 'paid with ************1117.'],
    ['after punctuation', 'No.4111111111111111, ok', 'No.************1111, ok'],
    ['in parentheses', '(4111111111111111)', '(************1111)'],
  ])('masks a Luhn-valid %s, keeping the last 4 digits', (_, input, expected) => {
    expect(redactText(input)).toBe(expected);
  });

  it('masks 13- and 19-digit numbers in the 4-4-4-1 and 4-4-4-4-3 groupings', () => {
    const n19 = withCheckDigit('400000000000000000');
    expect(n19).toHaveLength(19);
    expect(redactText(n19)).toBe(`${'*'.repeat(15)}${n19.slice(-4)}`);
    const grouped19 = `${n19.slice(0, 4)} ${n19.slice(4, 8)} ${n19.slice(8, 12)} ${n19.slice(12, 16)} ${n19.slice(16)}`;
    expect(redactText(grouped19)).toBe(`**** **** **** ***${n19.slice(15, 16)} ${n19.slice(16)}`);
    const n13 = withCheckDigit('400000000000');
    expect(redactText(`${n13.slice(0, 4)}-${n13.slice(4, 8)}-${n13.slice(8, 12)}-${n13.slice(12)}`)).toBe(
      `****-****-*${n13.slice(9, 12)}-${n13.slice(12)}`,
    );
  });

  it('masks Luhn-valid numbers of any length from 13 to 19', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 9 }), { minLength: 12, maxLength: 18 }), (body) => {
        const card = withCheckDigit(body.join(''));
        expect(redactText(`x ${card} y`)).toBe(`x ${'*'.repeat(card.length - 4)}${card.slice(-4)} y`);
      }),
    );
  });

  it.each([
    ['Luhn-invalid digits', '4111111111111112'],
    ['Luhn-invalid spaced digits', '4111 1111 1111 1112'],
    ['12 Luhn-valid digits', withCheckDigit('41111111111')],
    ['20 Luhn-valid digits', withCheckDigit('4111111111111111111')],
    ['mixed separators', '4111 1111-1111 1111'],
    ['double spaces', '4111  1111  1111  1111'],
    ['three groups', '4111 1111 1111'],
    ['phone number', '+62 812-3456-7890 / 0812 3456 7890'],
    ['digits glued to a word', 'x4111111111111111 4111111111111111x _4111111111111111'],
    ['decimal fraction', '0.4111111111111111 and 4111111111111111.5'],
    ['comma decimal', '1,4111111111111111 and 4111111111111111,5'],
    ['IDR amounts with dots', 'Rp42.810.000 · Rp4.111.111.111.111.111 · 1.000.000.000.000'],
    ['amounts with commas', '42,810,000 and 4,111,111,111,111,111'],
    ['dates', '2026-10-18 2026-10-19 2026-10-20 18-10-2026'],
    ['timestamp', '2026-10-18T07:30:00.000Z'],
  ])('leaves %s alone', (_, input) => {
    expect(redactText(input)).toBe(input);
  });

  it('never changes formatted amounts or ISO dates', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n }), (amount) => {
        for (const locale of ['id-ID', 'en-US']) {
          const text = new Intl.NumberFormat(locale).format(amount);
          expect(redactText(`Rp${text}`)).toBe(`Rp${text}`);
        }
      }),
    );
    fc.assert(
      fc.property(fc.array(fc.date({ noInvalidDate: true }), { maxLength: 5 }), (dates) => {
        const text = dates.map((date) => date.toISOString().slice(0, 10)).join(' ');
        expect(redactText(text)).toBe(text);
      }),
    );
  });
});
