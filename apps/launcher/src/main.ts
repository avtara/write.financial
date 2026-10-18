// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The container image's command (deploy/docker/entrypoint → src/cli.ts):
 * - `web`, `worker`: merges the variables derived from the secrets volume (src/env.ts) into `process.env`, then loads
 *   the web server or the worker in this process, so signals from tini reach it directly.
 * - `init`: one-shot setup before web and worker (src/init.ts).
 * - `backup`: one encrypted archive of the database and the objects (src/backup.ts).
 * - `restore <archive> [--force] [--identity <file>]`: replaces the data with an archive's (src/restore.ts).
 * - `healthcheck web`: GET /healthz on the local web server. `healthcheck worker`: the worker's heartbeat check.
 */
import { fileURLToPath } from 'node:url';
import { runBackup, type BackupDeps } from './backup.ts';
import { secretsEnv } from './env.ts';
import { runInit, type InitDeps } from './init.ts';
import { runRestore, type RestoreDeps } from './restore.ts';

/** Where the launcher finds the apps in the image (and in the repo): `/app/apps/{launcher,web,worker}`. */
export const ENTRIES = {
  web: new URL('../../web/.output/server/index.mjs', import.meta.url).href,
  worker: new URL('../../worker/src/main.ts', import.meta.url).href,
};

export const USAGE =
  'Usage: wf-launcher <web | worker | init | backup | restore <archive> [--force] [--identity <file>] | ' +
  'healthcheck web | healthcheck worker>';

/** The parts of `process` the launcher changes before loading an app. */
export interface LaunchProcess {
  readonly argv: string[];
  readonly env: Record<string, string | undefined>;
}

export interface LaunchDeps extends InitDeps, BackupDeps, RestoreDeps {
  readonly importEntry: (url: string) => Promise<unknown>;
  readonly fetch: (url: string, init: { signal: AbortSignal }) => Promise<Response>;
}

/** Loads an app's entry module (a dependency seam: tests load a `data:` module instead of starting the app). */
export function importEntry(url: string): Promise<unknown> {
  return import(url);
}

const HEALTHCHECK_TIMEOUT_MS = 5_000;

/** Runs the command in `args` and returns the exit code (0 ok, 1 failure, 2 usage). `web`/`worker` keep running. */
export async function main(args: readonly string[], proc: LaunchProcess, deps: LaunchDeps): Promise<number> {
  if (args[0] === 'restore') return runRestore(args.slice(1), proc.env, deps);
  const command = args.join(' ');
  try {
    switch (command) {
      case 'init':
        return await runInit(proc.env, deps);
      case 'backup':
        return await runBackup(proc.env, deps);
      case 'healthcheck web': {
        // The Nitro server listens on `PORT` too.
        const port = proc.env.PORT ?? '3000';
        const response = await deps.fetch(`http://127.0.0.1:${port}/healthz`, {
          signal: AbortSignal.timeout(HEALTHCHECK_TIMEOUT_MS),
        });
        const body: unknown = response.ok ? await response.json() : null;
        return typeof body === 'object' && body !== null && 'status' in body && body.status === 'ok' ? 0 : 1;
      }
      case 'web':
        Object.assign(proc.env, await secretsEnv(proc.env));
        await deps.importEntry(ENTRIES.web);
        return 0;
      case 'worker':
      case 'healthcheck worker':
        Object.assign(proc.env, await secretsEnv(proc.env));
        // The worker parses `process.argv.slice(2)` and exits the process itself.
        proc.argv.splice(1, Infinity, fileURLToPath(ENTRIES.worker));
        if (command === 'healthcheck worker') proc.argv.push('--healthcheck');
        await deps.importEntry(ENTRIES.worker);
        return 0;
      default:
        deps.output.error(USAGE);
        return 2;
    }
  } catch (error) {
    deps.output.error(`${command} failed: ${String(error)}`);
    return 1;
  }
}
