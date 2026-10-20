// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { fakeDeps } from '../../test/fakes.ts';
import { createOccurrencesProcessor } from './occurrences.ts';

const USER = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c7d';

describe('occurrences processor', () => {
  it("advances the user's occurrences as of the job clock", async () => {
    const deps = fakeDeps();
    const run = createOccurrencesProcessor(deps);
    expect(await run({ id: `occ.${USER}.2026-10-18`, data: { userId: USER }, attemptsMade: 0 })).toEqual({
      materialized: 3,
      due: 1,
      overdue: 0,
      notifications: 1,
    });
    expect(deps.db.calls).toEqual([{ method: 'occurrences.advance', args: [USER, deps.now()] }]);
  });

  it('rejects a payload without a user id before touching the database', async () => {
    const deps = fakeDeps();
    await expect(createOccurrencesProcessor(deps)({ id: 'x', data: {}, attemptsMade: 0 })).rejects.toThrow();
    expect(deps.db.calls).toEqual([]);
  });
});
