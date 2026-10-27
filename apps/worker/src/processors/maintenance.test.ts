// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { fakeDb, fakeDeps } from '../../test/fakes.ts';
import { createMaintenanceProcessor } from './maintenance.ts';

const now = new Date('2026-10-18T20:30:00Z');
const job = (data: unknown) => ({ id: 'repeat:maintenance-daily:1', data, attemptsMade: 0 });

describe('maintenance processor', () => {
  it('purges Gmail evidence with an exact 30-day cutoff alongside existing auth/AI/notification retention', async () => {
    const db = fakeDb();
    const result = await createMaintenanceProcessor(fakeDeps({ db }, now))(job({}));
    expect(result).toMatchObject({ gmailLogs: 3, aiLogs: 0 });
    expect(db.gmailPurgeCalls).toEqual([new Date('2026-09-18T20:30:00Z')]);
    expect(db.calls).toContainEqual({ method: 'maintenance.purgeAiLogs', args: [now] });
  });
  it('rejects a payload that is not the empty maintenance payload, before touching the database', async () => {
    const db = fakeDb();
    const process = createMaintenanceProcessor(fakeDeps({ db }, now));
    await expect(process(job({ userId: 'x' }))).rejects.toThrow(/Unrecognized key/);
    expect(db.purgeCalls).toEqual([]);
    expect(db.gmailPurgeCalls).toEqual([]);
  });

  it('fails the job when a purge fails, so BullMQ retries it', async () => {
    const db = fakeDb();
    const process = createMaintenanceProcessor(
      fakeDeps(
        {
          db: {
            ...db,
            maintenance: { ...db.maintenance, purgeExpiredAuth: () => Promise.reject(new Error('connection refused')) },
          },
        },
        now,
      ),
    );
    await expect(process(job({}))).rejects.toThrow('connection refused');
  });
});
