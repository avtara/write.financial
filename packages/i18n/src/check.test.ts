// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCatalogs, findUnusedKeys, MESSAGES_DIR, messageKeys, readCatalogs, run, SOURCE_GLOBS } from './check.ts';
import type { Catalog } from './check.ts';

const SCHEMA = { $schema: 'https://inlang.com/schema/inlang-message-format' };

const PLURAL_EN = [
  {
    declarations: ['input count', 'local countPlural = count: plural'],
    selectors: ['countPlural'],
    match: { 'countPlural=one': '{count: number} transaction', 'countPlural=*': '{count: number} transactions' },
  },
];

let root: string;

function file(relative: string, content: string): void {
  const full = path.join(root, relative);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function catalogs(id: Catalog, en: Catalog): void {
  file(`${MESSAGES_DIR}/id.json`, JSON.stringify({ ...SCHEMA, ...id }));
  file(`${MESSAGES_DIR}/en.json`, JSON.stringify({ ...SCHEMA, ...en }));
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'i18n-check-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the real catalogs', () => {
  it('are complete and consistent in every locale', () => {
    const dir = fileURLToPath(new URL('../messages', import.meta.url));
    expect(checkCatalogs(readCatalogs(dir))).toEqual([]);
  });
});

describe('messageKeys', () => {
  it('returns the sorted union of keys without $schema', () => {
    expect(messageKeys({ id: { ...SCHEMA, b: 'x', a: 'x' }, en: { c: 'x', a: 'x' } })).toEqual(['a', 'b', 'c']);
  });
});

describe('checkCatalogs', () => {
  it('accepts matching simple, formatted, plural, markup, and escaped messages', () => {
    const id = {
      greeting: 'Halo, {name}!',
      count: '{count: number} transaksi',
      rate: 'Kurs {amount: number style=currency currency=$currency}',
      link: '{#link to=|/docs|}Baca{/link} \\{bukan placeholder\\}',
      literal: '{|teks apa adanya|}',
    };
    const en = {
      greeting: 'Hi {name}!',
      count: PLURAL_EN,
      rate: 'Rate {$amount: number style=currency currency=$currency}',
      link: '{#link to=|/docs|}Read{/link} \\{not a placeholder\\}',
      literal: [{ match: { '*': '{|verbatim text|}' } }],
    };
    expect(checkCatalogs({ id, en })).toEqual([]);
  });

  it('reports a key missing from either locale', () => {
    expect(checkCatalogs({ id: { a: 'A', b: 'B' }, en: { b: 'B', c: 'C' } })).toEqual([
      { kind: 'missing', key: 'a', locale: 'en' },
      { kind: 'missing', key: 'c', locale: 'id' },
    ]);
  });

  it('reports placeholders that differ between locales, including through declarations', () => {
    expect(
      checkCatalogs({
        id: { greeting: 'Halo, {nama}!', count: '{count} transaksi', sum: 'Total {total}' },
        en: {
          greeting: 'Hi {name}!',
          count: PLURAL_EN,
          sum: [{ declarations: ['input total', 'input extra'], match: { '*': 'Total {total}' } }],
        },
      }),
    ).toEqual([
      { kind: 'placeholders', key: 'greeting', placeholders: { id: ['nama'], en: ['name'] } },
      { kind: 'placeholders', key: 'sum', placeholders: { id: ['total'], en: ['extra', 'total'] } },
    ]);
  });

  it('reports empty text in a simple message or any variant', () => {
    expect(
      checkCatalogs({
        id: { a: '', b: [{ match: { 'x=one': 'satu', 'x=*': '  ' } }] },
        en: { a: 'A', b: [{ match: { 'x=one': 'one', 'x=*': 'many' } }] },
      }),
    ).toEqual([
      { kind: 'empty', key: 'a', locale: 'id' },
      { kind: 'empty', key: 'b', locale: 'id' },
    ]);
  });

  it.each([
    ['a number', 42],
    ['null', null],
    ['a nested object', { title: 'Judul' }],
    ['an empty variant list', []],
    ['a non-object variant', ['text']],
    ['a null variant', [null]],
    ['variants without match', [{}]],
    ['a null match', [{ match: null }]],
    ['an empty match', [{ match: {} }]],
    ['a non-string pattern', [{ match: { '*': 1 } }]],
    ['non-string declarations', [{ declarations: [1], match: { '*': 'x' } }]],
    ['non-array selectors', [{ selectors: 'x', match: { '*': 'x' } }]],
    ['an unknown declaration', [{ declarations: ['output x'], match: { '*': 'x' } }]],
  ])('reports %s as invalid without comparing placeholders', (_, value) => {
    expect(checkCatalogs({ id: { a: 'A' }, en: { a: value } })).toEqual([{ kind: 'invalid', key: 'a', locale: 'en' }]);
  });
});

describe('readCatalogs', () => {
  it('reads one JSON object per locale', () => {
    catalogs({ a: 'A id' }, { a: 'A en' });
    expect(readCatalogs(path.join(root, MESSAGES_DIR))).toEqual({
      id: { ...SCHEMA, a: 'A id' },
      en: { ...SCHEMA, a: 'A en' },
    });
  });

  it.each(['[]', 'null', '"text"'])('rejects a catalog that is %s instead of an object', (content) => {
    catalogs({}, {});
    file(`${MESSAGES_DIR}/en.json`, content);
    expect(() => readCatalogs(path.join(root, MESSAGES_DIR))).toThrow(
      /en\.json must contain a JSON object of messages$/,
    );
  });
});

describe('findUnusedKeys', () => {
  it('counts whole-identifier mentions in app and package sources, but not tests or generated code', () => {
    file('apps/web/src/routes/index.tsx', 'export const t = () => m.used_in_app();\n');
    file(
      'packages/reports/src/pdf.ts',
      "import { used_in_package } from '@wf/i18n/messages';\nm['used.with.dots']();\n",
    );
    file('apps/web/src/routes/index.test.tsx', 'm.only_in_test();\n');
    file('packages/i18n/src/paraglide/messages/only_generated.js', 'export const only_generated = 1;\n');
    file('apps/web/node_modules/dep/src/x.ts', 'only_in_dependency();\n');
    file('apps/web/scripts/x.ts', 'only_outside_src();\n');
    file('apps/web/src/other.ts', 'm.used_in_app_suffix(); $prefixed_key; dottedXkey();\n');
    const keys = [
      'used_in_app',
      'used_in_package',
      'used.with.dots',
      'only_in_test',
      'only_generated',
      'only_in_dependency',
      'only_outside_src',
      'prefixed_key',
      'used_in',
      'dotted.key',
    ];
    expect(findUnusedKeys(keys, root, SOURCE_GLOBS)).toEqual([
      'only_in_test',
      'only_generated',
      'only_in_dependency',
      'only_outside_src',
      'prefixed_key',
      'used_in',
      'dotted.key',
    ]);
  });
});

describe('run', () => {
  const output = { log: vi.fn<(message: string) => void>(), error: vi.fn<(message: string) => void>() };

  beforeEach(() => {
    output.log.mockClear();
    output.error.mockClear();
  });

  it('passes complete catalogs and does not look for unused keys by default', () => {
    catalogs({ a: 'A' }, { a: 'A' });
    expect(run([], root, output)).toBe(0);
    expect(output.log).toHaveBeenCalledWith('Message catalogs are complete in id, en.');
  });

  it('lists every catalog problem', () => {
    catalogs({ a: 'A {x}', b: '', c: 1 }, { a: 'A {y}', b: 'B', c: 'C', d: 'D' });
    expect(run([], root, output)).toBe(1);
    expect(output.error).toHaveBeenCalledWith(
      [
        'Message catalog problems in packages/i18n/messages:',
        '  - a: placeholders differ (id: {x}; en: {y})',
        '  - b: empty text in id',
        '  - c: not a valid message in id (expected a string or an array of variants)',
        '  - d: missing in id',
      ].join('\n'),
    );
  });

  it('reports unused keys with --unused', () => {
    catalogs({ used: 'U', unused: 'X' }, { used: 'U', unused: 'X' });
    file('apps/web/src/a.tsx', 'm.used();\n');
    expect(run(['--unused'], root, output)).toBe(1);
    expect(output.error).toHaveBeenCalledWith(
      'Message catalog problems in packages/i18n/messages:\n' +
        '  - unused: not used in apps/*/src/**/*.{ts,tsx}, packages/*/src/**/*.{ts,tsx}',
    );
    file('apps/web/src/b.tsx', 'm.unused();\n');
    expect(run(['--unused'], root, output)).toBe(0);
  });

  it('prints usage for unknown arguments', () => {
    expect(run(['--fix'], root, output)).toBe(2);
    expect(run(['--unused', 'extra'], root, output)).toBe(2);
    expect(output.error).toHaveBeenCalledWith('Usage: check-i18n [--unused]');
  });
});
