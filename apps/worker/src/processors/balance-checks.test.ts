// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { fakeDeps } from '../../test/fakes.ts';
import { createBalanceChecksProcessor } from './balance-checks.ts';

const USER = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c7d';

describe('balance-checks processor', () => {
  it("checks the user's balances as of the job clock", async () => {
    const deps = fakeDeps();
    const run = createBalanceChecksProcessor(deps);
    expect(await run({ id: `bal.${USER}.2026-10-18`, data: { userId: USER }, attemptsMade: 0 })).toEqual({
      lowBalance: 1,
      unchecked: 0,
      insufficient: 0,
    });
    expect(deps.db.calls).toEqual([{ method: 'balanceChecks.check', args: [USER, deps.now()] }]);
  });

  it('rejects an invalid payload', async () => {
    const deps = fakeDeps();
    await expect(createBalanceChecksProcessor(deps)({ id: 'x', data: {}, attemptsMade: 0 })).rejects.toThrow();
    expect(deps.db.calls).toEqual([]);
  });
});
