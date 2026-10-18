// SPDX-License-Identifier: AGPL-3.0-only
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
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
    // React components (D26 + PRD §7.1): text comes from message functions, money from <Money>/<Delta>.
    files: ['**/*.tsx'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      'wf/money-via-component': 'error',
      'wf/no-hardcoded-jsx-text': 'error',
    },
  },
  {
    // Tests render fixture text; the components under test take all user-facing text via props.
    files: ['**/*.test.tsx'],
    rules: { 'wf/no-hardcoded-jsx-text': 'off' },
  },
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
