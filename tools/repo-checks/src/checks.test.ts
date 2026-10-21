// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findFilesWithoutSpdx, findMigrationProblems, findSourceFilesWithoutTests, SPDX_HEADER } from './checks.ts';

let root: string;

function file(relative: string, content = `// ${SPDX_HEADER}\n`): void {
  const full = path.join(root, relative);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'repo-checks-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('findSourceFilesWithoutTests', () => {
  it('reports source files that have no co-located test, sorted', () => {
    file('packages/domain/src/money.ts');
    file('packages/domain/src/money.test.ts');
    file('packages/domain/src/period.ts');
    file('apps/web/src/components/Button.tsx');
    file('apps/web/src/components/Card.tsx');
    file('apps/web/src/components/Card.test.tsx');
    expect(findSourceFilesWithoutTests(root)).toEqual([
      'apps/web/src/components/Button.tsx',
      'packages/domain/src/period.ts',
    ]);
  });

  it('accepts a .test.tsx for a .ts source and ignores generated, declaration, and non-src files', () => {
    file('apps/web/src/hooks/use-money.ts');
    file('apps/web/src/hooks/use-money.test.tsx');
    file('apps/web/src/paraglide/messages.ts');
    file('packages/db/src/schema/generated/tables.ts');
    file('packages/domain/src/env.d.ts');
    file('packages/domain/vitest.config.ts');
    file('packages/domain/node_modules/dep/src/index.ts');
    expect(findSourceFilesWithoutTests(root)).toEqual([]);
  });
});

describe('findFilesWithoutSpdx', () => {
  it('reports code files whose first three lines lack the header', () => {
    file('packages/domain/src/money.ts');
    file('packages/domain/src/late.ts', '\n\n\n// ' + SPDX_HEADER + '\n');
    file('tools/repo-checks/src/cli.ts', '#!/usr/bin/env node\n// ' + SPDX_HEADER + '\n');
    file('eslint.config.js', 'export default [];\n');
    file('vitest.config.ts');
    expect(findFilesWithoutSpdx(root)).toEqual(['eslint.config.js', 'packages/domain/src/late.ts']);
  });

  it('ignores dependencies, build output, coverage, and generated code', () => {
    file('packages/domain/node_modules/x/index.js', 'x');
    file('apps/web/dist/main.js', 'x');
    file('apps/web/.output/server.mjs', 'x');
    file('apps/web/coverage/prettify.js', 'x');
    file('apps/web/src/paraglide/runtime.js', 'x');
    expect(findFilesWithoutSpdx(root)).toEqual([]);
  });
});

describe('findMigrationProblems', () => {
  function migrations(files: readonly string[], tags: readonly string[], idx = (position: number) => position): void {
    for (const name of files) file(`packages/db/migrations/${name}`, '');
    const entries = tags.map((tag, position) => ({ idx: idx(position), tag }));
    file('packages/db/migrations/meta/_journal.json', JSON.stringify({ version: '7', entries }));
  }

  it('accepts consecutive files that match the journal, ignoring meta and non-SQL files', () => {
    migrations(['0000_init.sql', '0001_security.sql'], ['0000_init', '0001_security']);
    file('packages/db/migrations/meta/0000_snapshot.json', '{}');
    file('packages/db/migrations/README.md', '');
    expect(findMigrationProblems(root)).toEqual([]);
  });

  it('accepts an empty folder with an empty journal', () => {
    migrations([], []);
    expect(findMigrationProblems(root)).toEqual([]);
  });

  it('reports badly named files, gaps, and duplicate numbers', () => {
    migrations(['0000_init.sql', '0002_b.sql', '0002_c.sql', 'extra.sql'], ['0000_init', '0002_b', '0002_c', 'extra']);
    expect(findMigrationProblems(root)).toEqual([
      'extra.sql: expected NNNN_name.sql',
      'gap: no migration numbered 0001',
      'duplicate number 0002: 0002_b.sql, 0002_c.sql',
    ]);
  });

  it('reports journal entries with the wrong idx, the wrong order, or no file, and files without an entry', () => {
    migrations(['0000_a.sql', '0001_b.sql', '0002_c.sql'], ['0000_a', '0002_c', '0001_b', '0003_d'], (p) =>
      p === 3 ? 7 : p,
    );
    expect(findMigrationProblems(root)).toEqual([
      'meta/_journal.json: entry 3 ("0003_d") has idx 7',
      'meta/_journal.json: entry 1 is "0002_c", but migration file 1 is 0001_b.sql',
      'meta/_journal.json: entry 2 is "0001_b", but migration file 2 is 0002_c.sql',
      'meta/_journal.json: entry "0003_d" has no 0003_d.sql',
    ]);
    migrations(['0003_d.sql', '0004_e.sql'], ['0000_a', '0001_b', '0002_c']);
    expect(findMigrationProblems(root)).toEqual([
      'meta/_journal.json: no entry for 0003_d.sql',
      'meta/_journal.json: no entry for 0004_e.sql',
    ]);
  });
});
