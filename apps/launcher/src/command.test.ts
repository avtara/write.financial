// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandError, runCommand } from './command.ts';

/** Runs a Node.js one-liner as the child. */
const node = (script: string, options: Parameters<typeof runCommand>[2] = { env: {} }) =>
  runCommand(process.execPath, ['-e', script], options);

async function* chunks(...parts: string[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) {
    await Promise.resolve();
    yield new TextEncoder().encode(part);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('runCommand', () => {
  it('streams the input to stdin and resolves with stdout; of the environment, the child inherits only PATH', async () => {
    vi.stubEnv('WF_PARENT_ONLY', 'secret');
    const script = `process.stdin.pipe(process.stdout); process.stdin.on('end', () => process.stdout.write(JSON.stringify([process.env.PGPASSWORD, process.env.PATH, process.env.WF_PARENT_ONLY ?? null])));`;
    const out = await node(script, { env: { PGPASSWORD: 'x' }, input: chunks('PGDMP', ' data') });
    expect(out.toString()).toBe(`PGDMP data${JSON.stringify(['x', process.env.PATH, null])}`);
  });

  it('gives the child an empty, closed stdin without input', async () => {
    const out = await node(
      `process.stdin.on('data', () => process.exit(3)).on('end', () => process.stdout.write('eof'))`,
    );
    expect(out.toString()).toBe('eof');
  });

  it('fails with the exit status and stderr', async () => {
    await expect(node(`console.error('pg_dump: error: connection refused'); process.exit(3)`)).rejects.toThrow(
      new CommandError(`${process.execPath} exited with status 3: pg_dump: error: connection refused`),
    );
  });

  it('fails with the signal that killed the child', async () => {
    await expect(node(`process.kill(process.pid, 'SIGKILL')`)).rejects.toThrow(
      new CommandError(`${process.execPath} was killed by SIGKILL`),
    );
  });

  it('fails when the command cannot be started', async () => {
    await expect(runCommand('/nonexistent/pg_dump', [], { env: {} })).rejects.toThrow(/ENOENT/);
  });

  it('lets the exit status decide when the child stops reading its input early', async () => {
    const big = new Uint8Array(1 << 20);
    async function* input() {
      await Promise.resolve();
      for (let index = 0; index < 64; index++) yield big;
    }
    expect((await node(`process.stdout.write('done'); process.exit(0)`, { env: {}, input: input() })).toString()).toBe(
      'done',
    );
    await expect(node('process.exit(4)', { env: {}, input: input() })).rejects.toThrow('exited with status 4');
  });

  it('fails with the error of the input rather than the exit status it causes', async () => {
    async function* input() {
      await Promise.resolve();
      yield new Uint8Array(10);
      throw new Error('archive chunk failed authentication');
    }
    await expect(node('process.stdin.resume()', { env: {}, input: input() })).rejects.toThrow(
      'archive chunk failed authentication',
    );
  });
});
