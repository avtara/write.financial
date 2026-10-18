// SPDX-License-Identifier: AGPL-3.0-only
/**
 * D14 architecture test: parses the imports of every worker source file (static, `export … from`, type-only, dynamic
 * `import()`, `require`) with the TypeScript parser and fails on the modules d14.ts forbids.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { DB_CONNECTION_FILE, DB_CONNECTION_MODULE, FORBIDDEN_IMPORTS, WORKER_REPOSITORIES } from './d14.ts';

const SRC = path.dirname(fileURLToPath(import.meta.url));

interface SourceFile {
  /** Relative to `apps/worker/src`, with `/` separators. */
  readonly file: string;
  readonly text: string;
}

/** Every worker runtime file; tests are not part of the worker process and may use fixtures. */
function workerSources(): SourceFile[] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => ({ file: file.split(path.sep).join('/'), text: readFileSync(path.join(SRC, file), 'utf8') }));
}

const matches = (specifier: string, module: string) => specifier === module || specifier.startsWith(`${module}/`);

/** One message per forbidden import in `sources`. */
function d14Violations(sources: readonly SourceFile[]): string[] {
  return sources.flatMap(({ file, text }) =>
    ts.preProcessFile(text, true, true).importedFiles.flatMap(({ fileName: specifier }) => {
      const forbidden = FORBIDDEN_IMPORTS.find(({ module }) => matches(specifier, module));
      if (forbidden !== undefined) return [`${file} imports ${specifier}: ${forbidden.reason}`];
      if (matches(specifier, DB_CONNECTION_MODULE) && file !== DB_CONNECTION_FILE) {
        return [`${file} imports ${specifier}: only ${DB_CONNECTION_FILE} opens the database (WorkerDb)`];
      }
      if (specifier.startsWith('.') && path.posix.join(path.posix.dirname(file), specifier).startsWith('..')) {
        return [`${file} imports ${specifier}: relative imports must stay inside apps/worker/src`];
      }
      return [];
    }),
  );
}

describe('D14: the worker cannot reach transactions, postings, budgets, goals, or auth', () => {
  it('finds the worker sources', () => {
    expect(workerSources().map(({ file }) => file)).toEqual(
      expect.arrayContaining(['main.ts', 'worker-db.ts', 'processors/maintenance.ts']),
    );
  });

  it('no worker source imports a forbidden module', () => {
    expect(d14Violations(workerSources())).toEqual([]);
  });

  it('detects every import form, subpaths, the raw connection outside worker-db.ts, and relative escapes', () => {
    const fixture = (file: string, text: string) => ({ file, text });
    expect(
      d14Violations([
        fixture('processors/a.ts', `import { createTransactions } from '@wf/db/transactions';`),
        fixture('processors/b.ts', `import type { Session } from '@wf/auth/server';`),
        fixture('processors/c.ts', `export * from '@wf/db/schema';`),
        fixture('processors/d.ts', `const pg = await import('postgres');`),
        fixture('processors/e.ts', `const { sql } = require('drizzle-orm');`),
        fixture('processors/f.ts', `import { createDb } from '@wf/db/db';`),
        fixture('processors/g.ts', `import { budgets } from '../../../../packages/db/src/budgets.ts';`),
        fixture('worker-db.ts', `import { createDb } from '@wf/db/db';`),
        fixture('processors/ok.ts', `import { JOBS } from '@wf/jobs/queues'; import { x } from '../worker-db.ts';`),
        fixture('processors/near-miss.ts', `import { x } from '@wf/authz'; import { y } from 'postgres-array';`),
      ]),
    ).toEqual([
      `processors/a.ts imports @wf/db/transactions: D14: only a user confirmation creates or changes transactions`,
      `processors/b.ts imports @wf/auth/server: the worker has no access to sessions or credentials (it connects as wf_worker)`,
      `processors/c.ts imports @wf/db/schema: raw tables bypass the WorkerDb repositories`,
      `processors/d.ts imports postgres: only @wf/db opens Postgres connections (plan §3)`,
      `processors/e.ts imports drizzle-orm: only @wf/db queries Postgres (plan §3)`,
      `processors/f.ts imports @wf/db/db: only worker-db.ts opens the database (WorkerDb)`,
      `processors/g.ts imports ../../../../packages/db/src/budgets.ts: relative imports must stay inside apps/worker/src`,
    ]);
  });

  it('forbids each D14 repository family', () => {
    expect(FORBIDDEN_IMPORTS.map(({ module }) => module)).toEqual(
      expect.arrayContaining(['@wf/auth', '@wf/db/transactions', '@wf/db/postings', '@wf/db/budgets', '@wf/db/goals']),
    );
    expect(WORKER_REPOSITORIES).toEqual(['maintenance']);
  });
});
