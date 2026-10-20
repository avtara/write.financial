// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { fakeDeps } from '../../test/fakes.ts';
import { createDetectRecurringProcessor } from './detect-recurring.ts';

const USER = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c7d';

describe('detect-recurring processor', () => {
  it("detects the user's subscription candidates as of the job clock", async () => {
    const deps = fakeDeps();
    const run = createDetectRecurringProcessor(deps);
    expect(await run({ id: `det.${USER}.2026-10-18`, data: { userId: USER }, attemptsMade: 0 })).toEqual({
      created: 1,
      updated: 0,
    });
    expect(deps.db.calls).toEqual([{ method: 'detectRecurring.detect', args: [USER, deps.now()] }]);
  });

  it('rejects an invalid payload', async () => {
    const deps = fakeDeps();
    await expect(createDetectRecurringProcessor(deps)({ id: 'x', data: {}, attemptsMade: 0 })).rejects.toThrow();
    expect(deps.db.calls).toEqual([]);
  });
});
