// SPDX-License-Identifier: AGPL-3.0-only
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const SPDX_HEADER = 'SPDX-License-Identifier: AGPL-3.0-only';

/** Generated code we do not write ourselves (D27). Kept in sync with `vitest.config.ts`. */
const GENERATED = ['**/node_modules/**', '**/src/paraglide/**', '**/src/**/generated/**'];

/**
 * D27: every source file under `{apps,packages,tools}/*\/src` needs a co-located
 * `*.test.ts` or `*.test.tsx`. Returns the offending paths, relative to `root`.
 */
export function findSourceFilesWithoutTests(root: string): string[] {
  const sources = globSync('{apps,packages,tools}/*/src/**/*.{ts,tsx}', {
    cwd: root,
    exclude: [...GENERATED, '**/*.test.{ts,tsx}', '**/*.d.ts'],
  });
  return sources
    .filter((file) => {
      const base = file.replace(/\.tsx?$/, '');
      return !['.test.ts', '.test.tsx'].some((ext) => globSync(`${base}${ext}`, { cwd: root }).length > 0);
    })
    .sort();
}

/** Every first-party code file must start with the SPDX header within its first three lines. */
export function findFilesWithoutSpdx(root: string): string[] {
  const files = globSync(['{apps,packages,tools}/**/*.{ts,tsx,js,mjs,cjs}', '*.{ts,js,mjs,cjs}'], {
    cwd: root,
    exclude: [...GENERATED, '**/dist/**', '**/.output/**', '**/coverage/**'],
  });
  return files
    .filter((file) => {
      const head = readFileSync(path.join(root, file), 'utf8').split('\n', 3).join('\n');
      return !head.includes(SPDX_HEADER);
    })
    .sort();
}
