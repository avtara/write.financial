// SPDX-License-Identifier: AGPL-3.0-only
import { Linter } from 'eslint';
import { expect, it } from 'vitest';
import { plugin } from './index.ts';

it('registers every rule under the wf plugin prefix', () => {
  const linter = new Linter();
  const messages = linter.verify('/* v8 ignore next */\nconst a = <p title={balanceMinor}>Halo</p>;', {
    plugins: { wf: plugin },
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
      'wf/no-unjustified-coverage-ignore': 'error',
      'wf/no-hardcoded-jsx-text': 'error',
      'wf/money-via-component': 'error',
    },
  });
  expect(messages.map((m) => m.ruleId).sort()).toEqual([
    'wf/money-via-component',
    'wf/no-hardcoded-jsx-text',
    'wf/no-unjustified-coverage-ignore',
  ]);
});
