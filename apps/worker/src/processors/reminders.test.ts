// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { fakeDeps } from '../../test/fakes.ts';
import { createRemindersProcessor } from './reminders.ts';

const USER = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c7d';
const OCCURRENCE = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c7e';

describe('reminders processor', () => {
  it('sends the reminder of one occurrence as of the job clock', async () => {
    const deps = fakeDeps();
    const run = createRemindersProcessor(deps);
    const data = { userId: USER, occurrenceId: OCCURRENCE };
    expect(await run({ id: `rem.${OCCURRENCE}`, data, attemptsMade: 0 })).toEqual({ reminded: true, emailed: true });
    expect(deps.db.calls).toEqual([{ method: 'occurrences.remind', args: [USER, OCCURRENCE, deps.now()] }]);
  });

  it('rejects a payload without the occurrence', async () => {
    const deps = fakeDeps();
    await expect(
      createRemindersProcessor(deps)({ id: 'x', data: { userId: USER }, attemptsMade: 0 }),
    ).rejects.toThrow();
    expect(deps.db.calls).toEqual([]);
  });
});
