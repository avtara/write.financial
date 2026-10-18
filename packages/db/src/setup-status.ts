// SPDX-License-Identifier: AGPL-3.0-only
import { createDb, firstRow } from './db.ts';
import { instanceSettings } from './schema.ts';

/**
 * True while the first-run setup wizard (FR-OP1) has not been completed (`instance_settings.setup_completed_at` is
 * null). Opens its own single connection with `url` and closes it again; the self-host `init` calls it as `wf_migrate`
 * after migrating, to decide whether to print the setup URL.
 * @throws {MissingRowError} if the settings row is missing (migrations not applied).
 */
export async function isSetupPending(url: string): Promise<boolean> {
  const db = createDb(url, { max: 1 });
  try {
    const rows = await db.select({ completedAt: instanceSettings.setupCompletedAt }).from(instanceSettings);
    return firstRow(rows, 'instance_settings').completedAt === null;
  } finally {
    await db.$client.end();
  }
}
