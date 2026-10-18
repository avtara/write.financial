// SPDX-License-Identifier: AGPL-3.0-only
/** Runs the PostgreSQL client tools for `backup` and `restore` (the dependency seam their unit tests replace). */
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface CommandOptions {
  /** The child's environment. Of the parent's, only `PATH` is passed on, so secrets reach only the commands given them. */
  readonly env: Readonly<Record<string, string>>;
  /** Streamed to the child's stdin, which is closed afterwards; without it stdin is empty. */
  readonly input?: AsyncIterable<Uint8Array>;
}

/** Runs `command` to completion and resolves with its stdout. */
export type RunCommand = (command: string, args: readonly string[], options: CommandOptions) => Promise<Buffer>;

/** The command exited with a non-zero status or was killed; the message ends with what it wrote to stderr. */
export class CommandError extends Error {
  override readonly name = 'CommandError';
}

/**
 * `RunCommand` over `child_process.spawn`. A child that exits before reading all of its input fails the write with
 * EPIPE; its exit status decides then. An error of the input itself (e.g. a corrupt archive) wins over the exit status
 * it causes, because it is the reason the child failed.
 */
export const runCommand: RunCommand = async (command, args, { env, input }) => {
  const child = spawn(command, args, { env: { PATH: process.env.PATH, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
  const exited = new Promise<[number | null, NodeJS.Signals | null]>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code: number | null, signal: NodeJS.Signals | null) => {
      resolve([code, signal]);
    });
  });
  const fed = pipeline(Readable.from(input ?? []), child.stdin).then(
    () => undefined,
    (error: unknown) => error as NodeJS.ErrnoException,
  );
  const [code, signal] = await exited;
  const inputError = await fed;
  if (inputError !== undefined && inputError.code !== 'EPIPE') throw inputError;
  if (code !== 0) {
    const status = signal === null ? `exited with status ${String(code)}` : `was killed by ${signal}`;
    const message = Buffer.concat(stderr).toString('utf8').trim();
    throw new CommandError(`${command} ${status}${message === '' ? '' : `: ${message}`}`);
  }
  return Buffer.concat(stdout);
};
