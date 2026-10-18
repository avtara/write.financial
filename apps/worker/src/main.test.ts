// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.restoreAllMocks();
});

it('runs with argv and the process environment and exits with the result', async () => {
  vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'main.ts', '--help']);
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  // Dynamic import is intentional: main.ts runs on load, so it must load after argv is stubbed.
  await import('./main.ts');
  expect(error).toHaveBeenCalledWith('Usage: wf-worker [--healthcheck]');
  expect(exit).toHaveBeenCalledWith(2);
  // Loading BullMQ and ioredis takes a few seconds when the whole suite runs in parallel.
}, 30_000);
