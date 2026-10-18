// SPDX-License-Identifier: AGPL-3.0-only
import { createDb } from '@wf/db/db';
import { createMaintenance, type Maintenance } from '@wf/db/maintenance';

/**
 * The only database access processors get (D14, plan §6): one key per repository in `WORKER_REPOSITORIES` (d14.ts),
 * nothing else. There is deliberately no raw connection or transaction here.
 */
export interface WorkerDb {
  readonly maintenance: Maintenance;
}

export interface WorkerDbConnection {
  readonly db: WorkerDb;
  /** Ends the pool; waits for running queries. */
  close(): Promise<void>;
}

/** Opens a lazily connecting pool as `wf_worker` (`DATABASE_URL_WORKER`). */
export function openWorkerDb(url: string): WorkerDbConnection {
  const database = createDb(url, { max: 4 });
  return {
    db: Object.freeze({ maintenance: createMaintenance(database) }),
    close: () => database.$client.end(),
  };
}
