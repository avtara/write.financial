// SPDX-License-Identifier: AGPL-3.0-only
import type { YearMonth } from '@wf/domain/period';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ledgerFixture, type LedgerFixture } from '../test/ledger-fixture.ts';
import { PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { linesIn, versionInForceIn } from './budget-core.ts';
import { createBudgets } from './budgets.ts';
import { withUser } from './db.ts';

let test: TestDatabase;
let ledger: LedgerFixture;
const ym = (value: string) => value as YearMonth;
const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);
const inForce = (label: string) =>
  asApp(() => withUser(test.db, ledger.userId, (tx) => versionInForceIn(tx, ym(label))));

beforeAll(async () => {
  test = await startMigrated();
  ledger = await ledgerFixture(test, 'avtara@example.test');
  const budgets = createBudgets(test.db, { now: () => new Date('2026-08-15T05:00:00Z') });
  await asApp(() =>
    budgets.saveVersion(ledger.userId, {
      effectiveFrom: ym('2026-09'),
      expectedIncomeMinor: 26_000_000n,
      lines: [
        { categoryId: ledger.category('system:rent'), limitMinor: 4_500_000n },
        { categoryId: ledger.category('system:food'), limitMinor: 3_500_000n },
      ],
    }),
  );
  await asApp(() =>
    budgets.saveVersion(ledger.userId, {
      effectiveFrom: ym('2026-11'),
      lines: [{ categoryId: ledger.category('system:food'), limitMinor: 3_700_000n }],
    }),
  );
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

describe('versionInForceIn', () => {
  it('has no version before the first one', async () => {
    expect(await inForce('2026-08')).toBeNull();
  });

  it('applies a version from its label until the next one, lines in their order', async () => {
    for (const label of ['2026-09', '2026-10']) {
      const version = await inForce(label);
      expect(version).toMatchObject({ effectiveFrom: '2026-09', expectedIncomeMinor: 26_000_000n });
      expect(version?.lines.map((line) => [line.categoryId, line.limitMinor, line.isFixed, line.alertPct])).toEqual([
        [ledger.category('system:rent'), 4_500_000n, true, 85],
        [ledger.category('system:food'), 3_500_000n, false, 85],
      ]);
    }
    expect(await inForce('2027-03')).toMatchObject({ effectiveFrom: '2026-11', expectedIncomeMinor: 26_000_000n });
  });

  it('leaves out lines of deleted categories', async () => {
    const version = await inForce('2026-09');
    await test.query(`UPDATE categories SET deleted_at = now() WHERE id = $1`, [ledger.category('system:rent')]);
    try {
      const lines = await asApp(() => withUser(test.db, ledger.userId, (tx) => linesIn(tx, version?.id as string)));
      expect(lines.map((line) => line.categoryId)).toEqual([ledger.category('system:food')]);
    } finally {
      await test.query(`UPDATE categories SET deleted_at = NULL WHERE id = $1`, [ledger.category('system:rent')]);
    }
  });
});
