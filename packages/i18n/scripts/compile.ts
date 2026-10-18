// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Compiles `project.inlang` + `messages/*.json` into `src/paraglide/` (generated, gitignored).
 *
 * Runs automatically as this package's `prepare` script on every `pnpm install`, so a fresh clone
 * typechecks and tests without a separate step. Run `pnpm --filter @wf/i18n compile` after editing messages.
 */
import { fileURLToPath } from 'node:url';
import { compile } from '@inlang/paraglide-js';
import { LOCALE_COOKIE_NAME } from '../src/locale.ts';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));

await compile({
  project: `${packageRoot}project.inlang`,
  outdir: `${packageRoot}src/paraglide`,
  // The server resolves the locale itself (`resolveLocale`); the runtime only keeps the cookie in sync.
  strategy: ['cookie', 'globalVariable', 'baseLocale'],
  cookieName: LOCALE_COOKIE_NAME,
  emitTsDeclarations: true,
  emitReadme: false,
});
