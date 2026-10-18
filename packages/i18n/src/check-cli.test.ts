// SPDX-License-Identifier: AGPL-3.0-only
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

it('checks the catalogs under the working directory with the argv flags and sets the exit code', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'i18n-check-cli-'));
  try {
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'check-cli.ts', '--bogus']);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Dynamic import is intentional: check-cli.ts runs on load, so it must load after argv/cwd are stubbed.
    await import('./check-cli.ts');
    expect(error).toHaveBeenCalledWith('Usage: check-i18n [--unused]');
    expect(process.exitCode).toBe(2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
