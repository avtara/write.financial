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

/** drizzle-kit's `out` folder (`packages/db/drizzle.config.ts`), relative to the repository root. */
export const MIGRATIONS_DIR = 'packages/db/migrations';

interface Journal {
  entries: { idx: number; tag: string }[];
}

/**
 * Migrations apply in journal order, so a rebase that leaves two branches' `NNNN_*.sql` on one number, skips a number,
 * or forgets the journal entry breaks deployments. Checks that the SQL files are numbered 0000, 0001, … without gaps or
 * duplicates and that `meta/_journal.json` lists exactly those files, in that order, with `idx` = position.
 * Returns the problems found (empty when the folder is consistent).
 */
export function findMigrationProblems(root: string): string[] {
  const dir = path.join(root, MIGRATIONS_DIR);
  const files = globSync('*.sql', { cwd: dir }).sort();
  const problems: string[] = [];
  const byNumber = new Map<number, string[]>();
  for (const file of files) {
    const match = /^(\d{4})_\w+\.sql$/.exec(file);
    if (match === null) {
      problems.push(`${file}: expected NNNN_name.sql`);
      continue;
    }
    const number = Number(match[1]);
    byNumber.set(number, [...(byNumber.get(number) ?? []), file]);
  }
  const highest = Math.max(-1, ...byNumber.keys());
  for (let number = 0; number <= highest; number++) {
    const named = byNumber.get(number);
    const label = String(number).padStart(4, '0');
    if (named === undefined) problems.push(`gap: no migration numbered ${label}`);
    else if (named.length > 1) problems.push(`duplicate number ${label}: ${named.join(', ')}`);
  }

  const journal = JSON.parse(readFileSync(path.join(dir, 'meta/_journal.json'), 'utf8')) as Journal;
  const tags = files.map((file) => file.replace(/\.sql$/, ''));
  journal.entries.forEach((entry, position) => {
    if (entry.idx !== position)
      problems.push(`meta/_journal.json: entry ${position} ("${entry.tag}") has idx ${entry.idx}`);
  });
  for (let position = 0; position < Math.max(tags.length, journal.entries.length); position++) {
    const file = tags[position];
    const entry = journal.entries[position]?.tag;
    if (file === entry) continue;
    if (entry === undefined) problems.push(`meta/_journal.json: no entry for ${file}.sql`);
    else if (file === undefined) problems.push(`meta/_journal.json: entry "${entry}" has no ${entry}.sql`);
    else
      problems.push(
        `meta/_journal.json: entry ${position} is "${entry}", but migration file ${position} is ${file}.sql`,
      );
  }
  return problems;
}
