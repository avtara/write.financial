// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

it('runs the command named in argv and sets the exit code', async () => {
  vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'cli.ts', 'help']);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  // Dynamic import is intentional: cli.ts runs on load, so it must load after argv is stubbed.
  await import('./cli.ts');
  expect(error).toHaveBeenCalledWith('Usage: wf-db <bootstrap|migrate|rewrap-keys|seed --email <user>>');
  expect(process.exitCode).toBe(2);
});
