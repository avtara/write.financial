// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';
import { parseKeyring } from '@wf/crypto/keyring';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { WORKER_REPOSITORIES, type WorkerRepository } from './d14.ts';
import { openWorkerDb, type WorkerDb } from './worker-db.ts';

const keyring = parseKeyring(`v1:${randomBytes(32).toString('base64')}\n`);
const URL_ = 'postgres://wf_worker:unused@127.0.0.1:9/write_financial';

describe('WorkerDb (D14)', () => {
  it('has exactly the allowed repositories, at compile time', () => {
    expectTypeOf<keyof WorkerDb>().toEqualTypeOf<WorkerRepository>();
    // @ts-expect-error a raw connection is not part of WorkerDb
    expectTypeOf<WorkerDb['execute']>().toBeNever();
    // @ts-expect-error the periods repository is reduced to `lock`
    expectTypeOf<WorkerDb['periods']['changeStartDay']>().toBeNever();
  });

  it('exposes exactly the allowed repositories and worker methods at run time, frozen', async () => {
    // The pool connects lazily, so no database is needed to open and close it.
    const connection = openWorkerDb(URL_, keyring, { now: () => new Date() });
    const { db } = connection;
    expect(Object.keys(db)).toEqual([...WORKER_REPOSITORIES]);
    expect(Object.isFrozen(db)).toBe(true);
    expect(Object.fromEntries(Object.entries(db).map(([key, repository]: [string, object]) => [key, Object.keys(repository)]))).toEqual({
      maintenance: ['purgeExpiredAuth', 'purgeNotifications'],
      // Only the built-in side of fx_rates: no manual-rate reads or writes.
      fxRates: ['currenciesInUse', 'upsertGlobal'],
      dispatch: ['users', 'dueReminders', 'pendingOutbox'],
      occurrences: ['advance', 'remind'],
      periods: ['lock'],
      periodClose: ['endedPeriods', 'propose'],
      budgetAlerts: ['check'],
      balanceChecks: ['check'],
      detectRecurring: ['detect'],
      outbox: ['get', 'markSent', 'markFailed'],
    });
    for (const repository of Object.values(db)) expect(Object.isFrozen(repository)).toBe(true);
    expect(connection.smtp).toEqual(expect.any(Function));
    await expect(connection.close()).resolves.toBeUndefined();
    await expect(openWorkerDb(URL_, keyring).close()).resolves.toBeUndefined();
  });
});
