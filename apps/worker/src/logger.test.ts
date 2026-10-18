// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { captureLog } from '../test/fakes.ts';
import { createLogger } from './logger.ts';

describe('createLogger', () => {
  it('writes JSON lines tagged with the service, at the configured level', () => {
    const log = captureLog();
    const logger = createLogger('info', log);
    logger.debug('hidden');
    logger.info({ queue: 'maintenance' }, 'job started');
    expect(log.lines).toEqual([
      expect.objectContaining({ level: 30, service: 'worker', queue: 'maintenance', msg: 'job started' }),
    ]);
  });

  it('censors secret keys, also nested', () => {
    const log = captureLog();
    createLogger('info', log).info(
      { apiKey: 'sentinel', err: { config: { headers: { authorization: 'sentinel' } } } },
      'x',
    );
    expect(JSON.stringify(log.lines)).not.toContain('sentinel');
    expect(log.lines[0]).toMatchObject({
      apiKey: '[REDACTED]',
      err: { config: { headers: { authorization: '[REDACTED]' } } },
    });
  });

  it('writes to stdout by default', () => {
    expect(createLogger('silent').level).toBe('silent');
  });
});
