// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The fx job against PostgreSQL 18.6 with the roles bootstrapped and the migrations applied (Testcontainers): the
 * worker (`wf_worker`, through `WorkerDb`) learns every user's currencies and writes global `fx_rates` rows; the app
 * (`wf_app`) reads them as reference rates but cannot insert, change, or delete them, and the worker cannot write a
 * user's manual rate. The sources are fakes: this proves the database side, the adapters have their own HTTP tests.
 */
import { randomBytes } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDb } from '@wf/db/db';
import { createFxRates } from '@wf/db/fx-rates';
import { migrate } from '@wf/db/migrate';
import { bootstrapRoles, ROLES, type RoleName } from '@wf/db/roles';
import { parseKeyring } from '@wf/crypto/keyring';
import { parseLocalDate } from '@wf/domain/period';
import type { FxProvider, FxQuery } from '@wf/integrations/fx/provider';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fakeDeps } from '../../test/fakes.ts';
import { FAKE_S3 } from '../../test/fakes.ts';
import { openWorkerDb, type WorkerDbConnection } from '../worker-db.ts';
import { createFxProcessor } from './fx.ts';

const password = (role: string) => `${role}-${randomBytes(6).toString('hex')}`;
const PASSWORDS = {
  app: password('app'),
  worker: password('worker'),
  migrate: password('migrate'),
  auth: password('auth'),
  readonlyOps: null,
};

let pg: StartedPostgreSqlContainer;
let superuser: postgres.Sql;
let worker: WorkerDbConnection;
let userA: string;
let userB: string;

function urlAs(role: RoleName, rolePassword: string): string {
  const url = new URL(pg.getConnectionUri());
  url.username = role;
  url.password = rolePassword;
  return url.href;
}

beforeAll(async () => {
  pg = await new PostgreSqlContainer('postgres:18.6').start();
  superuser = postgres(pg.getConnectionUri(), { max: 2, onnotice: () => undefined });
  await bootstrapRoles(pg.getConnectionUri(), PASSWORDS);
  await migrate(urlAs(ROLES.migrate, PASSWORDS.migrate));
  const users = await superuser<{ id: string }[]>`
    INSERT INTO users (name, email) VALUES ('Ayu', 'ayu@example.test'), ('Budi', 'budi@example.test') RETURNING id`;
  [userA, userB] = users.map((row) => row.id) as [string, string];
  await superuser`
    INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_date, color) VALUES
      (${userA}, 'bank', 'Kasikorn', 'Kasikorn THB', 'THB', '2026-01-01', '#000000'),
      (${userB}, 'cash', 'Dompet', 'Won', 'KRW', '2026-01-01', '#000000')`;
  worker = openWorkerDb(
    urlAs(ROLES.worker, PASSWORDS.worker),
    parseKeyring(`v1:${randomBytes(32).toString('base64')}\n`),
    { s3: FAKE_S3 },
  );
});

afterAll(async () => {
  await worker.close();
  await superuser.end();
  await pg.stop();
});

/** Answers every base with a fixed rate, dated 2026-10-19, and records what it was asked. */
function fakeSource(rate: string, queries: FxQuery[] = []): FxProvider {
  return {
    name: 'frankfurter',
    hosts: [],
    fetchRates: (query) => {
      queries.push(query);
      return Promise.resolve(
        query.bases.map((base) => ({
          base,
          quote: query.quote,
          rate,
          provider: 'frankfurter' as const,
          rateType: 'bi_transaction' as const,
          asOf: parseLocalDate('2026-10-19'),
        })),
      );
    },
  };
}

const job = { id: 'fx.2026-10-19', data: {}, attemptsMade: 0 };

describe('fx job (wf_worker → fx_rates)', () => {
  it("fetches every user's currencies and writes global rows, idempotently per publication day", async () => {
    const queries: FxQuery[] = [];
    const run = createFxProcessor(fakeDeps({ db: worker.db }), () => [fakeSource('17948.00000000', queries)]);
    expect(await run(job)).toEqual({ written: { frankfurter: 10 }, missing: [], failures: [] });
    expect(queries[0]?.bases).toEqual(['AUD', 'CNY', 'EUR', 'GBP', 'JPY', 'KRW', 'MYR', 'SGD', 'THB', 'USD']);

    // A second run the same day (retry, manual refresh) updates the rows instead of adding more.
    const rerun = createFxProcessor(fakeDeps({ db: worker.db }), () => [fakeSource('17950.5')]);
    await rerun(job);
    const rows = await superuser<{ base: string; rate: string; user_id: string | null; rate_type: string }[]>`
      SELECT base, rate::text, user_id, rate_type::text FROM fx_rates ORDER BY base`;
    expect(rows).toHaveLength(10);
    expect(rows.every((row) => row.user_id === null && row.rate_type === 'bi_transaction')).toBe(true);
    expect(rows.find((row) => row.base === 'USD')?.rate).toBe('17950.50000000');
  });

  it('lets wf_app read the global rows as reference rates', async () => {
    const app = createDb(urlAs(ROLES.app, PASSWORDS.app), { max: 1 });
    try {
      const reference = await createFxRates(app).referenceRate(userB, 'USD', 'IDR');
      expect(reference).toMatchObject({
        base: 'USD',
        quote: 'IDR',
        provider: 'frankfurter',
        rateType: 'bi_transaction',
        asOf: '2026-10-19',
        manual: false,
      });
      expect(Number(reference?.rate)).toBe(17950.5);
    } finally {
      await app.$client.end();
    }
  });

  it('refuses wf_app any write to global rows and wf_worker any write to manual rows', async () => {
    const app = postgres(urlAs(ROLES.app, PASSWORDS.app), { max: 1, onnotice: () => undefined });
    const asWorker = postgres(urlAs(ROLES.worker, PASSWORDS.worker), { max: 1, onnotice: () => undefined });
    try {
      await expect(
        app.begin(async (tx) => {
          await tx`SELECT set_config('app.user_id', ${userA}, true)`;
          await tx`INSERT INTO fx_rates (base, quote, rate, provider, rate_type, as_of)
                   VALUES ('USD', 'IDR', 1, 'frankfurter', 'bi_transaction', '2026-10-20')`;
        }),
      ).rejects.toThrow(/row-level security/);
      await app.begin(async (tx) => {
        await tx`SELECT set_config('app.user_id', ${userA}, true)`;
        expect((await tx`UPDATE fx_rates SET rate = 1 WHERE user_id IS NULL`).count).toBe(0);
        expect((await tx`DELETE FROM fx_rates WHERE user_id IS NULL`).count).toBe(0);
      });
      await expect(app`SELECT fx_currencies_in_use()`).rejects.toThrow(/permission denied/);

      await expect(
        asWorker`INSERT INTO fx_rates (user_id, base, quote, rate, provider, rate_type, as_of)
                 VALUES (${userA}, 'USD', 'IDR', 1, 'manual', 'manual', '2026-10-20')`,
      ).rejects.toThrow(/row-level security/);
      await expect(asWorker`DELETE FROM fx_rates`).rejects.toThrow(/permission denied/);
      const [count] = await superuser<{ n: number }[]>`SELECT count(*)::int AS n FROM fx_rates`;
      expect(count?.n).toBe(10);
    } finally {
      await Promise.all([app.end(), asWorker.end()]);
    }
  });
});
