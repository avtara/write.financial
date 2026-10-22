// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as drizzleKit from 'drizzle-kit/api';
import { getTableName, is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
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

const tables = Object.values(schema).flatMap((value) => (is(value, PgTable) ? [value] : []));

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

  it('deletes every user-owned row with its user', () => {
    const userRefs = tables.flatMap((table) => {
      const config = getTableConfig(table);
      return config.foreignKeys.flatMap((fk) => {
        const ref = fk.reference();
        if (getTableName(ref.foreignTable) !== 'users') return [];
        return [`${config.name}.${ref.columns.map((column) => column.name).join(',')}:${fk.onDelete ?? ''}`];
      });
    });
    expect(userRefs.toSorted()).toEqual([
      'accounts.user_id:cascade',
      'accounts_auth.user_id:cascade',
      'activity_log.user_id:cascade',
      'allocation_targets.user_id:cascade',
      'asset_categories.user_id:cascade',
      'assets.user_id:cascade',
      'attachments.user_id:cascade',
      'balance_adjustments.user_id:cascade',
      'budget_alert_dismissals.user_id:cascade',
      'budget_lines.user_id:cascade',
      'budget_period_overrides.user_id:cascade',
      'budget_versions.user_id:cascade',
      'card_payment_allocations.user_id:cascade',
      'categories.user_id:cascade',
      'debt_installments.user_id:cascade',
      'debts.user_id:cascade',
      'detected_recurring.user_id:cascade',
      'drafts.user_id:cascade',
      'fx_rates.user_id:cascade',
      'goal_contribution_plans.user_id:cascade',
      'goal_funding_sources.user_id:cascade',
      'goals.user_id:cascade',
      'investment_trades.user_id:cascade',
      'invitations.invited_by:cascade',
      'market_api_logs.user_id:cascade',
      'market_credentials.user_id:cascade',
      'notification_outbox.user_id:cascade',
      'notifications.user_id:cascade',
      'passkeys.user_id:cascade',
      'periods.user_id:cascade',
      'portfolio_snapshots.user_id:cascade',
      'postings.user_id:cascade',
      'receivable_payments.user_id:cascade',
      'receivables.user_id:cascade',
      'recent_items.user_id:cascade',
      'recurrences.user_id:cascade',
      'review_items.user_id:cascade',
      'scheduled_occurrences.user_id:cascade',
      'security_events.user_id:cascade',
      'sessions.user_id:cascade',
      'subscriptions.user_id:cascade',
      'tag_aliases.user_id:cascade',
      'tags.user_id:cascade',
      'transaction_tags.user_id:cascade',
      'transactions.user_id:cascade',
      'transfer_meta.user_id:cascade',
      'two_factors.user_id:cascade',
      'user_keys.user_id:cascade',
      'user_plans.user_id:cascade',
      'user_preferences.user_id:cascade',
      'user_quotes.user_id:cascade',
    ]);
  });

  it('references plans by code', () => {
    const planRefs = tables.flatMap((table) =>
      getTableConfig(table)
        .foreignKeys.map((fk) => fk.reference())
        .filter((ref) => getTableName(ref.foreignTable) === 'plans')
        .map((ref) => `${getTableName(ref.foreignTable)}.${ref.foreignColumns[0]?.name ?? ''}`),
    );
    expect(planRefs).toEqual(['plans.code', 'plans.code']);
  });

  it('stores ciphertext and wrapped keys as bytea', () => {
    const binary = tables.flatMap((table) =>
      getTableConfig(table)
        .columns.filter((column) => /_(enc|wrapped)$/.test(column.name))
        .map((column) => `${getTableConfig(table).name}.${column.name}:${column.getSQLType()}`),
    );
    expect(binary.toSorted()).toEqual([
      'attachments.name_enc:bytea',
      'attachments.ocr_enc:bytea',
      'drafts.payload_enc:bytea',
      'instance_settings.instance_dek_wrapped:bytea',
      'instance_settings.smtp_password_enc:bytea',
      'market_credentials.api_key_enc:bytea',
      'receivables.counterparty_enc:bytea',
      'receivables.note_enc:bytea',
      'review_items.payload_enc:bytea',
      'transactions.note_enc:bytea',
      'user_keys.dek_wrapped:bytea',
    ]);
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
