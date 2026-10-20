// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { fakeDeps } from '../../test/fakes.ts';
import { createBudgetAlertsProcessor } from './budget-alerts.ts';

const USER = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c7d';

describe('budget-alerts processor', () => {
  it("checks the user's thresholds as of the job clock", async () => {
    const deps = fakeDeps();
    const run = createBudgetAlertsProcessor(deps);
    expect(await run({ id: `bud.${USER}.2026-10-18.09`, data: { userId: USER }, attemptsMade: 0 })).toEqual({
      created: 2,
    });
    expect(deps.db.calls).toEqual([{ method: 'budgetAlerts.check', args: [USER, deps.now()] }]);
  });

  it('rejects an invalid payload', async () => {
    const deps = fakeDeps();
    await expect(
      createBudgetAlertsProcessor(deps)({ id: 'x', data: { userId: 'u1' }, attemptsMade: 0 }),
    ).rejects.toThrow();
    expect(deps.db.calls).toEqual([]);
  });
});
