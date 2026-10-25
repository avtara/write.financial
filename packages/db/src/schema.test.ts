// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as drizzleKit from 'drizzle-kit/api';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMigrated, PGLITE_HOOK_TIMEOUT, type TestDatabase } from '../test/pglite.ts';
import { MIGRATIONS_FOLDER } from './migrate.ts';
import * as schema from './schema.ts';

/** Only the snapshot `id` is read here; the rest is opaque JSON passed back to drizzle-kit. */
interface Snapshot {
  readonly id: string;
}

// drizzle-kit/api's declarations reference types that do not resolve in this workspace (typed lint sees them as
// error types), so the two functions this test calls get a minimal local signature.
const kit = drizzleKit as unknown as {
  generateDrizzleJson(imports: Record<string, unknown>, prevId: string): Snapshot;
  generateMigration(prev: Snapshot, cur: Snapshot): Promise<string[]>;
};

let test: TestDatabase;

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

describe('schema', () => {
  it('matches the latest migration snapshot (run `pnpm --filter @wf/db generate` after changing it)', async () => {
    const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_FOLDER, 'meta/_journal.json'), 'utf8')) as {
      entries: { idx: number }[];
    };
    const last = String(journal.entries.at(-1)?.idx).padStart(4, '0');
    const snapshot = JSON.parse(
      readFileSync(path.join(MIGRATIONS_FOLDER, `meta/${last}_snapshot.json`), 'utf8'),
    ) as Snapshot;
    const current = kit.generateDrizzleJson(schema, snapshot.id);
    expect(await kit.generateMigration(snapshot, current)).toEqual([]);
  });

  it('generates UUID v7 ids and refreshes updated_at on update', async () => {
    const [user] = await test.db
      .insert(schema.users)
      .values({ name: 'Avtara', email: 'avtara@example.test' })
      .returning({ id: schema.users.id });
    expect(user?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    await test.query(`UPDATE users SET updated_at = '2020-01-01Z'`);
    const before = Date.now();
    const [updated] = await test.db
      .update(schema.users)
      .set({ nickname: 'Av' })
      .returning({ updatedAt: schema.users.updatedAt });
    expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});
