// SPDX-License-Identifier: AGPL-3.0-only
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { plugin as wf } from './tools/eslint-rules/src/index.ts';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.output/**', '**/coverage/**', '**/src/paraglide/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { wf },
    rules: {
      'wf/no-unjustified-coverage-ignore': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
