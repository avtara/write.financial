// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { fakeDeps } from '../../test/fakes.ts';
import { createRulesBackfillProcessor } from './rules-backfill.ts';

describe('rules-backfill processor', () => {
  it('refuses a payload without the owner and request id', async () => {
    const run = createRulesBackfillProcessor(fakeDeps());
    await expect(
      run({ id: 'job', data: { userId: '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c7d' }, attemptsMade: 0 }),
    ).rejects.toThrow();
  });
});
