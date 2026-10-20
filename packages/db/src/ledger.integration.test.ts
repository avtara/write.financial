// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The M1 ledger against a real PostgreSQL 18.6 (Testcontainers) with every role logging in with its own password:
 * the design seed reproduces the design balances and the Rp55.023.000 available balance, the IDR → USD transfer
 * records the −Rp22.660 FX difference, delete → Undo restores the balances, and the worker cannot write the ledger.
 */
import { randomUUID } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { FX_DIFFERENCE_CATEGORY } from '@wf/domain/categories';
import type { LocalDate } from '@wf/domain/period';
import { DESIGN_SEED, seedClosingBalances } from '@wf/domain/seed';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testKeyring } from '../test/keys.ts';
import { createAccounts } from './accounts.ts';
import { createCategories } from './categories.ts';
import { createDb, firstRow, type Database } from './db.ts';
import { createFxRates } from './fx-rates.ts';
import { migrate } from './migrate.ts';
import { bootstrapRoles, ROLES, type RoleName } from './roles.ts';
import { users } from './schema.ts';
import { seedLedger } from './seed.ts';
import { createTransactions } from './transactions.ts';
import { createUserKeys } from './user-keys.ts';

const password = (role: string) => `${role}-${Date.now().toString(36)}-pw`;
const PASSWORDS = {
  app: password('app'),
  worker: password('worker'),
  migrate: password('migrate'),
  auth: password('auth'),
  readonlyOps: null,
};

let container: StartedPostgreSqlContainer;
let app: Database;
let worker: Database;
let userId: string;
const { keyring } = testKeyring();

function urlAs(role: RoleName, rolePassword: string): string {
  const url = new URL(container.getConnectionUri());
  url.username = role;
  url.password = rolePassword;
  return url.href;
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:18.6').start();
  await bootstrapRoles(container.getConnectionUri(), PASSWORDS);
  await migrate(urlAs(ROLES.migrate, PASSWORDS.migrate));
  app = createDb(urlAs(ROLES.app, PASSWORDS.app));
  worker = createDb(urlAs(ROLES.worker, PASSWORDS.worker));
  const auth = createDb(urlAs(ROLES.auth, PASSWORDS.auth), { max: 1 });
  try {
    userId = firstRow(
      await auth.insert(users).values({ name: 'Avtara K.', email: 'avtara@example.test' }).returning({ id: users.id }),
      'users',
    ).id;
  } finally {
    await auth.$client.end();
  }
});

afterAll(async () => {
  await Promise.all([app.$client.end(), worker.$client.end()]);
  await container.stop();
});

describe('M1 ledger on PostgreSQL 18', () => {
  it('seeds 249 transactions (121 in the closed September, 128 in October) that reproduce the design balances and Rp55.023.000 available', async () => {
    const result = await seedLedger(app, userId, { getDek: createUserKeys(app, keyring).getOrCreateDek });
    expect(result.balances).toEqual(seedClosingBalances(DESIGN_SEED));
    expect(result.transactions).toBe(249);
    expect(result.closedPeriods).toBe(1);
    expect(result.availableMinor).toBe(55_023_000n);
    const overview = await createAccounts(app).list(userId);
    expect(overview.availableMinor).toBe(55_023_000n);
    expect(overview.missingRates).toEqual([]);
  });

  it('records the IDR → USD transfer with the −Rp22.660 FX difference, and Undo after delete', async () => {
    const accounts = createAccounts(app);
    const transactions = createTransactions(app, { getDek: createUserKeys(app, keyring).getOrCreateDek });
    const { accounts: seeded } = await accounts.list(userId);
    const bca = firstRow(
      seeded.filter((account) => account.displayName === 'BCA Tahapan'),
      'BCA Tahapan',
    );
    const gotrade = firstRow(
      seeded.filter((account) => account.currency === 'USD'),
      'Gotrade',
    );

    await createFxRates(app).upsertManual(userId, {
      base: 'USD',
      quote: 'IDR',
      rate: '16350.0275',
      asOf: '2026-10-15' as LocalDate,
    });
    const transfer = await transactions.create(userId, {
      type: 'transfer',
      clientId: randomUUID(),
      occurredAt: new Date('2026-10-15T12:30:00Z'),
      fromAccountId: bca.id,
      toAccountId: gotrade.id,
      sentMinor: 3_000_000n,
      receivedMinor: 18_210n,
      description: 'Top-up Gotrade',
    });
    expect(transfer.fxDifference).toEqual({
      expectedReceivedMinor: 18_349n,
      shortfallReceivedMinor: 139n,
      differenceBaseMinor: -22_660n,
    });
    const detail = await transactions.get(userId, transfer.id);
    const categories = createCategories(app, { getDek: createUserKeys(app, keyring).getOrCreateDek });
    const fxCategory = (await categories.list(userId)).find(
      (category) => category.builtInKey === FX_DIFFERENCE_CATEGORY,
    );
    expect(detail.postings.filter((posting) => posting.role === 'fx_diff')).toMatchObject([
      { amountMinor: 0n, amountBaseMinor: -22_660n, categoryId: fxCategory?.id },
    ]);
    expect((await accounts.get(userId, bca.id)).balanceMinor).toBe(39_810_000n);
    expect((await accounts.get(userId, gotrade.id)).balanceMinor).toBe(gotrade.balanceMinor + 18_210n);
    expect((await accounts.list(userId)).availableMinor).toBe(52_023_000n);

    expect(await transactions.remove(userId, [transfer.id])).toEqual({ deleted: [transfer.id] });
    expect((await accounts.get(userId, bca.id)).balanceMinor).toBe(42_810_000n);
    expect((await accounts.list(userId)).availableMinor).toBe(55_023_000n);
    expect(await transactions.restore(userId, [transfer.id])).toEqual({ restored: [transfer.id] });
    expect((await accounts.get(userId, bca.id)).balanceMinor).toBe(39_810_000n);
  });

  it('lets the worker read the ledger but never create or change a transaction (D14)', async () => {
    const overview = await createAccounts(worker).list(userId);
    expect(overview.accounts).toHaveLength(DESIGN_SEED.accounts.length);
    const [account] = overview.accounts;
    await expect(
      createTransactions(worker, { getDek: () => Promise.reject(new Error('unused')) }).create(userId, {
        type: 'expense',
        clientId: randomUUID(),
        occurredAt: new Date(),
        accountId: account?.id ?? '',
        amountMinor: 1n,
        categoryId: null,
      }),
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });
});
