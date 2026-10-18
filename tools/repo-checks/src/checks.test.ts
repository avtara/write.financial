// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findFilesWithoutSpdx, findSourceFilesWithoutTests, SPDX_HEADER } from './checks.ts';

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
