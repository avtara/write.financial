// SPDX-License-Identifier: AGPL-3.0-only
import type { ESLint } from 'eslint';
import { noUnjustifiedCoverageIgnore } from './no-unjustified-coverage-ignore.ts';

/** Project-specific lint rules, registered under the `wf` prefix. */
export const plugin: ESLint.Plugin = {
  meta: { name: '@wf/eslint-rules' },
  rules: {
    'no-unjustified-coverage-ignore': noUnjustifiedCoverageIgnore,
  },
};
