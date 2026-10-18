// SPDX-License-Identifier: AGPL-3.0-only
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger.ts';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  return { lines, stream };
}

describe('createLogger', () => {
  it('writes JSON lines tagged with the service', () => {
    const { lines, stream } = capture();
    createLogger('info', stream).info({ path: '/' }, 'request');
    expect(lines).toEqual([expect.objectContaining({ level: 30, service: 'web', path: '/', msg: 'request' })]);
  });

  it('censors secret keys at any depth', () => {
    const { lines, stream } = capture();
    createLogger('info', stream).info({ req: { headers: { cookie: 'wf_session=abc', authorization: 'Bearer x' } } });
    expect(lines[0]?.req).toEqual({ headers: { cookie: '[REDACTED]', authorization: '[REDACTED]' } });
  });

  it('drops lines below the configured level', () => {
    const { lines, stream } = capture();
    const logger = createLogger('warn', stream);
    logger.info('hidden');
    logger.warn('shown');
    expect(lines.map((line) => line.msg)).toEqual(['shown']);
  });
});
