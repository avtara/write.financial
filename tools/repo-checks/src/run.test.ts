// SPDX-License-Identifier: AGPL-3.0-only
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { run } from './run.ts';
import { SPDX_HEADER } from './checks.ts';

let root: string;
const output = { log: vi.fn<(message: string) => void>(), error: vi.fn<(message: string) => void>() };

function file(relative: string, content = `// ${SPDX_HEADER}\n`): void {
  const full = path.join(root, relative);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'repo-checks-cli-'));
  output.log.mockClear();
  output.error.mockClear();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('run', () => {
  it('passes test-files when every source has a test', () => {
    file('packages/a/src/x.ts');
    file('packages/a/src/x.test.ts');
    expect(run(['test-files'], root, output)).toBe(0);
    expect(output.log).toHaveBeenCalledWith('Every source file has a co-located test file.');
  });

  it('fails test-files and lists the missing files', () => {
    file('packages/a/src/x.ts');
    expect(run(['test-files'], root, output)).toBe(1);
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining('  - packages/a/src/x.ts'));
  });

  it('passes and fails the spdx check', () => {
    file('packages/a/src/x.ts');
    expect(run(['spdx'], root, output)).toBe(0);
    expect(output.log).toHaveBeenCalledWith('Every code file has the SPDX header.');
    file('packages/a/src/y.ts', 'export {};\n');
    expect(run(['spdx'], root, output)).toBe(1);
    expect(output.error).toHaveBeenCalledWith(expect.stringContaining('  - packages/a/src/y.ts'));
  });

  it('prints usage for unknown or missing checks', () => {
    expect(run([], root, output)).toBe(2);
    expect(run(['nope'], root, output)).toBe(2);
    expect(output.error).toHaveBeenCalledWith('Usage: repo-checks <test-files|spdx>');
  });
});
