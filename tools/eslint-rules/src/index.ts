// SPDX-License-Identifier: AGPL-3.0-only
import type { ESLint } from 'eslint';
import { moneyViaComponent } from './money-via-component.ts';
import { noHardcodedJsxText } from './no-hardcoded-jsx-text.ts';
import { noUnjustifiedCoverageIgnore } from './no-unjustified-coverage-ignore.ts';

/** Project-specific lint rules, registered under the `wf` prefix. */
export const plugin: ESLint.Plugin = {
  meta: { name: '@wf/eslint-rules' },
  rules: {
    'money-via-component': moneyViaComponent,
    'no-hardcoded-jsx-text': noHardcodedJsxText,
    'no-unjustified-coverage-ignore': noUnjustifiedCoverageIgnore,
  },
};
