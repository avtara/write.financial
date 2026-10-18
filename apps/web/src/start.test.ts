// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { requestMiddleware } from './server/request-middleware.ts';
import { startInstance } from './start.ts';

describe('startInstance', () => {
  it('runs the security and preferences middleware on every request', async () => {
    const options = await startInstance.getOptions();
    expect(options.requestMiddleware).toEqual([requestMiddleware]);
  });
});
