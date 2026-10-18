// SPDX-License-Identifier: AGPL-3.0-only
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, startMigrated, PGLITE_HOOK_TIMEOUT, type TestDatabase } from '../test/pglite.ts';
import { InvalidUserIdError } from './db.ts';
import { createEntitlements, type Entitlements } from './entitlements.ts';
import { FEATURES } from './schema.ts';

let test: TestDatabase;
let entitlements: Entitlements;
let alice: string;
let bob: string;

beforeAll(async () => {
  test = await startMigrated();
  entitlements = createEntitlements(test.db);
  // A restricted plan, as cloud mode may add later (D17); only migrations write plans in production.
  await test.query(`INSERT INTO plans (code, name) VALUES ('starter', 'Starter')`);
  await test.query(`INSERT INTO entitlements (plan_code, feature) VALUES ('starter', 'attachments')`);
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  alice = await insertUser(test, 'alice@example.test');
  bob = await insertUser(test, 'bob@example.test');
});

describe('can', () => {
  it('allows every feature on the default personal plan', async () => {
    for (const feature of FEATURES) {
      expect(await test.as('wf_app', () => entitlements.can(alice, feature))).toBe(true);
    }
  });

  it('follows the user’s own plan and no one else’s', async () => {
    await test.query(`INSERT INTO user_plans (user_id, plan_code) VALUES ($1, 'starter')`, [bob]);
    expect(await test.as('wf_worker', () => entitlements.can(bob, 'attachments'))).toBe(true);
    expect(await test.as('wf_worker', () => entitlements.can(bob, 'ai_assistant'))).toBe(false);
    expect(await test.as('wf_app', () => entitlements.can(alice, 'ai_assistant'))).toBe(true);
  });

  it('rejects a user id that is not a UUID', async () => {
    await expect(entitlements.can('x', 'attachments')).rejects.toBeInstanceOf(InvalidUserIdError);
  });
});
