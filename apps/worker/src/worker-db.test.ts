// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';
import { parseKeyring } from '@wf/crypto/keyring';
import { describe, expect, it } from 'vitest';
import { openWorkerDb } from './worker-db.ts';

const keyring = parseKeyring(`v1:${randomBytes(32).toString('base64')}\n`);
const URL_ = 'postgres://wf_worker:unused@127.0.0.1:9/write_financial';

describe('WorkerDb (D14)', () => {
  it('makes automation capabilities immutable at both object levels', async () => {
    // The pool connects lazily, so no database is needed to open and close it.
    const connection = openWorkerDb(URL_, keyring);
    const { db } = connection;
    expect(Object.isFrozen(db)).toBe(true);
    expect(Reflect.set(db, 'transactions', {})).toBe(false);
    expect(Reflect.set(db.periods, 'changeStartDay', () => undefined)).toBe(false);
    for (const repository of Object.values(db)) expect(Object.isFrozen(repository)).toBe(true);
    await connection.close();
  });
});
