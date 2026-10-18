// SPDX-License-Identifier: AGPL-3.0-only
import { Linter } from 'eslint';
import { expect, it } from 'vitest';
import { plugin } from './index.ts';

it('reports unjustified coverage ignores through the wf plugin prefix', () => {
  const linter = new Linter();
  const messages = linter.verify('/* v8 ignore next */\nconst a = 1;', {
    plugins: { wf: plugin },
    rules: { 'wf/no-unjustified-coverage-ignore': 'error' },
  });
  expect(messages.map((m) => m.ruleId)).toEqual(['wf/no-unjustified-coverage-ignore']);
});
