// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { fakeDeps } from '../../test/fakes.ts';
import { createReportsProcessor } from './reports.ts';

const USER = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c7d';

describe('reports processor', () => {
  it('generates the monthly report of every closed period that has none', async () => {
    const deps = fakeDeps();
    deps.db.reports.pendingMonthly = async () => [
      { id: '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c71', label: '2026-08' },
      { id: '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c72', label: '2026-09' },
    ];
    const result = await createReportsProcessor(deps)({ id: 'rep', data: { userId: USER }, attemptsMade: 0 });
    expect(result).toEqual({ generated: 2 });
    expect(deps.db.calls).toEqual([
      { method: 'reports.generate', args: [USER, { kind: 'monthly', periodId: '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c71' }, deps.now()] },
      { method: 'reports.generate', args: [USER, { kind: 'monthly', periodId: '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c72' }, deps.now()] },
    ]);
  });

  it('does nothing when every closed period already has its report', async () => {
    const deps = fakeDeps();
    const result = await createReportsProcessor(deps)({ id: 'rep', data: { userId: USER }, attemptsMade: 0 });
    expect(result).toEqual({ generated: 0 });
    expect(deps.db.calls.map((call) => call.method)).toEqual(['reports.pendingMonthly']);
  });

  it('refuses a payload without a user', async () => {
    const run = createReportsProcessor(fakeDeps());
    await expect(run({ id: 'rep', data: { userId: 'u1' }, attemptsMade: 0 })).rejects.toThrow();
    await expect(run({ id: 'rep', data: {}, attemptsMade: 0 })).rejects.toThrow();
  });
});
