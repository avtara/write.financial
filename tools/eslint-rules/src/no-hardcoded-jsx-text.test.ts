// SPDX-License-Identifier: AGPL-3.0-only
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { noHardcodedJsxText } from './no-hardcoded-jsx-text.ts';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({ languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } });
const error = (text: string) => ({ messageId: 'hardcoded', data: { text } });

ruleTester.run('no-hardcoded-jsx-text', noHardcodedJsxText, {
  valid: [
    '<p>{m.dashboard_title()}</p>',
    '<p>  {count} / {total}  </p>',
    '<p>(12) – 3,5% · 42.810.000</p>',
    '<span>Rp{"••••••"}</span>'.replace('Rp', ''),
    '<kbd>⌘ ↵</kbd>',
    '<><span>{label}</span>{`${count}×`}</>',
    '<p>{`12:30`}</p>',
    '<p>{42}</p>',
    '<img alt={m.logo_alt()} src="/logo.png" />',
    '<input placeholder={m.search()} type="search" name="q" />',
    '<input placeholder />',
    '<input aria-label={`${m.code_digit()} ${index + 1}`} />',
    '<div data-state="open" className="flex gap-2" role="dialog" />',
    '<svg xlink:title="Logo" />',
    '<Foo title={title} description={description} label={1} />',
    'const s = "Not JSX text";',
    { code: '<p>Rp</p>', options: [{ allow: ['Rp'] }] },
  ],
  invalid: [
    { code: '<p>Pemasukan</p>', errors: [error('Pemasukan')] },
    { code: '<p>\n  Saving rate 36,5%\n</p>', errors: [error('Saving rate 36,5%')] },
    { code: '<p>{"Halo"}</p>', errors: [error('Halo')] },
    { code: '<p>{`Halo`}</p>', errors: [error('Halo')] },
    { code: '<><b>{"Rp"}</b></>', errors: [error('Rp')] },
    { code: '<p>$</p>', errors: [error('$')] },
    { code: '<p>⌘K</p>', options: [{ allow: ['⌘'] }], errors: [error('⌘K')] },
    { code: '<p>⌘</p>', options: [{ allow: [] }], errors: [error('⌘')] },
    { code: '<img alt="Logo BCA" />', errors: [error('Logo BCA')] },
    { code: '<button title={"Tutup"} />', errors: [error('Tutup')] },
    { code: '<button aria-label={`Tutup`} />', errors: [error('Tutup')] },
    { code: '<input placeholder="Cari…" />', errors: [error('Cari…')] },
    {
      code: '<PageState title="Kosong" description="Belum ada data" />',
      errors: [error('Kosong'), error('Belum ada data')],
    },
    { code: '<Field label="Nama" />', errors: [error('Nama')] },
    {
      code: '<div aria-description="x" aria-placeholder="y" aria-roledescription="z" aria-valuetext="w" />',
      errors: 4,
    },
  ],
});
