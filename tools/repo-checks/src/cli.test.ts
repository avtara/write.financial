// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

it('runs the check named in argv against the working directory and sets the exit code', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'repo-checks-entry-'));
  try {
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'cli.ts', 'unknown-check']);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Dynamic import is intentional: cli.ts runs on load, so it must load after argv/cwd are stubbed.
    await import('./cli.ts');
    expect(error).toHaveBeenCalledWith('Usage: repo-checks <test-files|spdx>');
    expect(process.exitCode).toBe(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
