// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, expectTypeOf, it } from 'vitest';
import { WORKER_REPOSITORIES, type WorkerRepository } from './d14.ts';
import { openWorkerDb, type WorkerDb } from './worker-db.ts';

describe('WorkerDb (D14)', () => {
  it('has exactly the allowed repositories, at compile time', () => {
    expectTypeOf<keyof WorkerDb>().toEqualTypeOf<WorkerRepository>();
    // @ts-expect-error a raw connection is not part of WorkerDb
    expectTypeOf<WorkerDb['execute']>().toBeNever();
  });

  it('exposes exactly the allowed repositories at run time and cannot be extended', async () => {
    // The pool connects lazily, so no database is needed to open and close it.
    const connection = openWorkerDb('postgres://wf_worker:unused@127.0.0.1:9/write_financial');
    expect(Object.keys(connection.db)).toEqual([...WORKER_REPOSITORIES]);
    expect(Object.isFrozen(connection.db)).toBe(true);
    expect(Object.keys(connection.db.maintenance)).toEqual(['purgeExpiredAuth']);
    // Only the built-in side of fx_rates: no manual-rate reads or writes.
    expect(Object.keys(connection.db.fxRates)).toEqual(['currenciesInUse', 'upsertGlobal']);
    expect(Object.isFrozen(connection.db.fxRates)).toBe(true);
    await expect(connection.close()).resolves.toBeUndefined();
  });
});
