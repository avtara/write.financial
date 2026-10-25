// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import type { LocalDate } from '@wf/domain/period';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createAccounts } from './accounts.ts';
import { createAutoRules } from './auto-rules.ts';
import { withUser } from './db.ts';
import { builtInCategoryIn, recordTransactionIn } from './ledger-core.ts';
import { createRuleBackfillProposals } from './rule-backfill.ts';

const NOW = new Date('2026-10-15T09:00:00+07:00');

let test: TestDatabase;
let alice: string;
let account: string;
let transport: string;

beforeAll(async () => {
  test = await startMigrated();
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  alice = await insertUser(test, 'alice@example.test');
  account = (
    await test.as('wf_app', () =>
      createAccounts(test.db).create(alice, {
        type: 'bank',
        providerName: 'Bank',
        displayName: 'BCA',
        currency: 'IDR',
        color: 'blue',
        openingBalanceMinor: 10_000_000n,
        openingDate: '2026-09-30' as LocalDate,
      }),
    )
  ).id;
  transport = await test.as('wf_app', () =>
    withUser(test.db, alice, (tx) => builtInCategoryIn(tx, alice, 'system:transport')),
  );
});

describe('createRuleBackfillProposals', () => {
  it('builds a versioned proposal list from the read-only scope', async () => {
    const rules = createAutoRules(test.db, { now: () => NOW });
    const rule = await test.as('wf_app', () =>
      rules.create(alice, {
        input: {
          name: 'Kopi',
          enabled: true,
          conditions: [{ field: 'description', op: 'containsAny', values: ['kopi'] }],
          actions: [{ type: 'setCategory', categoryId: transport }],
        },
      }),
    );
    const id = (
      await test.as('wf_app', () =>
        withUser(test.db, alice, (tx) =>
          recordTransactionIn(
            tx,
            alice,
            {
              type: 'expense',
              clientId: randomUUID(),
              occurredAt: NOW,
              accountId: account,
              amountMinor: 25_000n,
              categoryId: null,
              description: 'Kopi pagi',
            },
            null,
            NOW,
          ),
        ),
      )
    ).id;
    const repository = createRuleBackfillProposals(test.db);
    const preview = await test.as('wf_app', () => repository.preview(alice, [rule.id]));
    expect(preview.ruleIds).toEqual([rule.id]);
    expect(preview.version).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.proposals).toEqual([
      expect.objectContaining({ transactionId: id, proposedCategoryId: transport, noop: false }),
    ]);

    await test.as('wf_app', () => rules.update(alice, rule.id, { ...rule, name: 'Kopi baru' }));
    const changed = await test.as('wf_app', () => repository.preview(alice, [rule.id]));
    expect(changed.version).not.toBe(preview.version);
  });

  it('has nothing to propose without enabled rules', async () => {
    const preview = await test.as('wf_app', () => createRuleBackfillProposals(test.db).preview(alice));
    expect(preview).toMatchObject({ proposals: [], ruleIds: [], truncated: false });
  });
});
