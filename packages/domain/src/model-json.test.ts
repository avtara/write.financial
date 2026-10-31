// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { modelMinorUnits, parseModelJsonObject } from './model-json.ts';

describe('parseModelJsonObject', () => {
  const object = { amountMinor: '10000', merchant: 'Toko {Kopi} "Senja"', nested: { ok: true } };
  const json = JSON.stringify(object);

  it.each([
    ['a plain object', json],
    ['a plain object with surrounding whitespace', `\n  ${json}\n`],
    ['one json fence', `\`\`\`json\n${json}\n\`\`\``],
    ['one bare fence', `\`\`\`\n${JSON.stringify(object, null, 2)}\n\`\`\`\n`],
    ['prose before a fence', `Berikut hasilnya:\n\`\`\`json\n${json}\n\`\`\``],
    ['prose around the object', `Here is the JSON: ${json} Let me know if anything is unclear.`],
  ])('unwraps %s', (_label, text) => {
    expect(parseModelJsonObject(text)).toEqual(object);
  });

  it.each([
    ['no JSON at all', 'not JSON'],
    ['an empty answer', ''],
    ['a top-level array', `[${json}]`],
    ['an array in prose', `Result: [${json}]`],
    ['a scalar', '"10000"'],
    ['null', 'null'],
    ['an unclosed object', `Result: {"amountMinor":"10000"`],
    ['an object that is not JSON', 'Result: {amountMinor: 10000}'],
    ['two candidate objects', `First: ${json}\nSecond: ${json}`],
  ])('refuses %s', (_label, text) => {
    expect(() => parseModelJsonObject(text)).toThrow();
  });
});

describe('modelMinorUnits', () => {
  it('converts a non-negative safe integer to its exact decimal string', () => {
    expect(modelMinorUnits(10000)).toBe('10000');
    expect(modelMinorUnits(0)).toBe('0');
    expect(modelMinorUnits(Number.MAX_SAFE_INTEGER)).toBe('9007199254740991');
  });

  it.each([1.5, -1, Number.MAX_SAFE_INTEGER + 1, Number.NaN, '10000', null, undefined])(
    'passes anything else through for strict validation: %j',
    (value) => {
      expect(modelMinorUnits(value)).toBe(value);
    },
  );
});
