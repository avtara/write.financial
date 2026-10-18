// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

it('runs the command named in argv against the working directory and sets the exit code', async () => {
  vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'cli.ts', 'unknown-command']);
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  // Dynamic import is intentional: cli.ts runs on load, so it must load after argv is stubbed.
  await import('./cli.ts');
  expect(error).toHaveBeenCalledWith('Usage: tokens-from-pen <write|check>');
  expect(process.exitCode).toBe(2);
});
