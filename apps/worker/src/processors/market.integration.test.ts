// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The market jobs against PostgreSQL 18.6 (Testcontainers) with the roles bootstrapped and the migrations applied: the
 * app saves Ayu's own EODHD key (2FA on); the worker's real processors (`dispatch`, `market-server`, `market-byok`,
 * `snapshots`) run on `WorkerDb` as `wf_worker` with fake adapters (no network). Built-in prices land in the global
 * cache for every user's symbols, Ayu's key prices only Ayu's `user_quotes` (Budi has none and reads none), a 429
 * pauses the source until `Retry-After` and the next run asks nothing, and a restart (new pool, every job run again
 * for the same slot) adds no row.
 */
import { randomBytes } from 'node:crypto';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { parseKeyring } from '@wf/crypto/keyring';
import { createDb, type Database } from '@wf/db/db';
import { createMarketCredentials } from '@wf/db/market-credentials';
import { createMarketData } from '@wf/db/market-data';
import { migrate } from '@wf/db/migrate';
import { bootstrapRoles, ROLES, type RoleName } from '@wf/db/roles';
import { createUserKeys } from '@wf/db/user-keys';
import type { MarketAdapters, QuoteProvider } from '@wf/integrations/market/adapters';
import type { AdapterFailure, FetchQuotesInput, MarketAdapter } from '@wf/integrations/market/http';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FAKE_S3, fakeAdapters, fakeDeps, fakeMailer } from '../../test/fakes.ts';
import { PROCESSORS, type ProcessorDeps } from '../processors.ts';
import { openWorkerDb, type WorkerDbConnection } from '../worker-db.ts';

const password = (role: string) => `${role}-${randomBytes(6).toString('hex')}`;
const PASSWORDS = {
  app: password('app'),
  worker: password('worker'),
  migrate: password('migrate'),
  auth: password('auth'),
  readonlyOps: null,
};
const keyring = parseKeyring(`v1:${randomBytes(32).toString('base64')}\n`);
const KEY = 'fake-eodhd-integration-key';
// Thursday 15 Oct 2026, 12.05 WIB: the IDX noon refresh.
const NOW = new Date('2026-10-15T05:05:00Z');

let pg: StartedPostgreSqlContainer;
let superuser: postgres.Sql;
let app: Database;
let ayu: string;
let budi: string;

function urlAs(role: RoleName, rolePassword: string): string {
  const url = new URL(pg.getConnectionUri());
  url.username = role;
  url.password = rolePassword;
  return url.href;
}

/** An adapter answering `price` for every request, or failing with `failure`; records what it was asked. */
function answering(
  provider: QuoteProvider,
  price: string,
  inputs: FetchQuotesInput[],
  failure: AdapterFailure | null = null,
) {
  const adapter: MarketAdapter = {
    provider,
    fetchQuotes: (input) => {
      inputs.push(input);
      return Promise.resolve({
        quotes:
          failure === null ? input.requests.map((request) => ({ ...request, price, prevClose: null, asOf: NOW })) : [],
        calls: [
          {
            provider,
            endpoint: 'GET /fake',
            httpStatus: failure === null ? 200 : 429,
            ok: failure === null,
            durationMs: 5,
            errorCode: failure?.code ?? null,
          },
        ],
        failure,
        unverified: false,
        credits: provider === 'coinmarketcap' && failure === null ? 1 : null,
      });
    },
  };
  return adapter;
}

const LIMITED: AdapterFailure = { status: 'rate_limited', retryAfter: '600', quotaResetAt: null, code: 'http_429' };

function depsOf(connection: WorkerDbConnection, adapters: Partial<MarketAdapters>, at = NOW): ProcessorDeps {
  return {
    ...fakeDeps({}, at),
    db: connection.db,
    mailer: fakeMailer(),
    market: { adapters: { ...fakeAdapters(), ...adapters }, cmcApiKey: 'fake-cmc-operator-key' },
  };
}

const count = async (query: string): Promise<number> =>
  Number((await superuser.unsafe<{ n: string }[]>(query))[0]?.n ?? 0);

async function asset(userId: string, symbol: string, currency: string, market: string): Promise<void> {
  const [account] = await superuser<{ id: string }[]>`
    INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_date, color)
    VALUES (${userId}, 'investment', 'P', 'P', ${currency}, '2026-01-01', 'cyan') RETURNING id`;
  await superuser`
    INSERT INTO assets (user_id, account_id, symbol, name, quote_currency, asset_class, market, price_mode)
    VALUES (${userId}, ${account?.id ?? ''}, ${symbol}, ${symbol}, ${currency}, 'indonesia', ${market}, 'server')`;
}

beforeAll(async () => {
  pg = await new PostgreSqlContainer('postgres:18.6').start();
  superuser = postgres(pg.getConnectionUri(), { max: 2, onnotice: () => undefined });
  await bootstrapRoles(pg.getConnectionUri(), PASSWORDS);
  await migrate(urlAs(ROLES.migrate, PASSWORDS.migrate));
  const users = await superuser<{ id: string }[]>`
    INSERT INTO users (name, email, two_factor_enabled)
    VALUES ('Ayu', 'ayu@example.test', true), ('Budi', 'budi@example.test', true) RETURNING id`;
  ayu = users[0]?.id as string;
  budi = users[1]?.id as string;
  await asset(ayu, 'BTC', 'IDR', 'crypto');
  await asset(ayu, 'BBCA', 'IDR', 'idx_equity');
  await asset(budi, 'BTC', 'IDR', 'crypto');
  await asset(budi, 'ETH', 'USD', 'crypto');
  await asset(budi, 'BBRI', 'IDR', 'idx_equity');
  app = createDb(urlAs(ROLES.app, PASSWORDS.app), { max: 1 });
  const { getOrCreateDek: getDek } = createUserKeys(app, keyring);
  await createMarketCredentials(app, { getDek }).save(ayu, { provider: 'eodhd', apiKey: KEY });
}, 180_000);

afterAll(async () => {
  await app.$client.end();
  await superuser.end();
  await pg.stop();
});

describe('market-server (wf_worker → market_quotes)', () => {
  it('prices the union of every user’s crypto once per currency, idempotently across a restart', async () => {
    const inputs: FetchQuotesInput[] = [];
    const run = async (adapter: MarketAdapter, at = NOW) => {
      const connection = openWorkerDb(urlAs(ROLES.worker, PASSWORDS.worker), keyring, { s3: FAKE_S3 });
      try {
        return await PROCESSORS['market-server'].create(depsOf(connection, { coinmarketcap: adapter }, at))({
          id: 'mks',
          data: { source: 'crypto' },
          attemptsMade: 0,
        });
      } finally {
        await connection.close();
      }
    };
    expect(await run(answering('coinmarketcap', '1459802000', inputs))).toMatchObject({ quotes: 2, quotaUsed: 1 });
    expect(inputs[0]?.requests).toEqual([
      { symbol: 'BTC', currency: 'IDR' },
      { symbol: 'ETH', currency: 'USD' },
    ]);
    // A restarted worker running the same slot again replaces the rows.
    await run(answering('coinmarketcap', '1460000000', inputs));
    expect(await count('SELECT count(*) AS n FROM market_quotes')).toBe(2);
    const [btc] = await superuser<{ price: string }[]>`
      SELECT price::text FROM market_quotes WHERE symbol = 'BTC' AND quote_currency = 'IDR'`;
    expect(btc?.price).toBe('1460000000.000000000000000000');
    expect(await count(`SELECT quota_used AS n FROM market_provider_state WHERE provider = 'coinmarketcap'`)).toBe(2);
    expect(await count('SELECT count(*) AS n FROM market_api_logs WHERE user_id IS NULL')).toBe(2);

    // 429: paused until Retry-After; the next run (5 minutes later) asks nothing and keeps the last prices.
    await run(answering('coinmarketcap', '1', inputs, LIMITED));
    const asked = inputs.length;
    expect(await run(answering('coinmarketcap', '1', inputs), new Date(NOW.getTime() + 300_000))).toMatchObject({
      skipped: 'paused',
      status: 'rate_limited',
    });
    expect(inputs).toHaveLength(asked);
    expect(btc?.price).toBe('1460000000.000000000000000000');
  });
});

describe('market-byok (the user’s own key → that user’s user_quotes)', () => {
  it('is dispatched for users with a key only, prices only their symbols, and stays theirs', async () => {
    const connection = openWorkerDb(urlAs(ROLES.worker, PASSWORDS.worker), keyring, { s3: FAKE_S3 });
    try {
      const inputs: FetchQuotesInput[] = [];
      const deps = depsOf(connection, { eodhd: answering('eodhd', '8750', inputs) });
      const dispatched: string[] = [];
      await PROCESSORS.dispatch.create({
        ...deps,
        enqueue: (queue, payload, { jobId }) => {
          if (queue === 'market-byok') dispatched.push(`${jobId} ${JSON.stringify(payload)}`);
          return Promise.resolve();
        },
      })({ id: 'dsp', data: {}, attemptsMade: 0 });
      expect(dispatched).toEqual([`mkb.${ayu}.2026-10-15T0505 {"userId":"${ayu}"}`]);

      const byok = PROCESSORS['market-byok'].create(deps);
      expect(await byok({ id: 'mkb', data: { userId: ayu }, attemptsMade: 0 })).toEqual({
        markets: [
          {
            market: 'idx_equity',
            priced: 2,
            missing: 0,
            runs: [{ provider: 'eodhd', status: 'connected' }],
            skipped: [],
          },
        ],
      });
      // BBCA and the IHSG benchmark, with the user's key, asked as EODHD symbols.
      expect(inputs[0]).toMatchObject({
        apiKey: KEY,
        requests: [
          { symbol: 'BBCA.JK', currency: 'IDR' },
          { symbol: 'JKSE.INDX', currency: 'IDR' },
        ],
      });
      expect(await count(`SELECT count(*) AS n FROM user_quotes WHERE user_id = '${ayu}'`)).toBe(2);
      expect(await count(`SELECT count(*) AS n FROM user_quotes WHERE user_id <> '${ayu}'`)).toBe(0);
      // Budi's own reads see none of Ayu's results.
      const ofBudi = [...(await createMarketData(app).quotes(budi)).values()];
      expect(ofBudi.some((quote) => quote?.source === 'byok')).toBe(false);
      expect(ofBudi.filter((quote) => quote === null)).toHaveLength(1);
      expect((await createMarketData(app).apiLog(budi)).filter((entry) => entry.own)).toEqual([]);

      // The same slot again (a retry, a restart): asked just now, so nothing is due and nothing is added.
      const restarted = openWorkerDb(urlAs(ROLES.worker, PASSWORDS.worker), keyring, { s3: FAKE_S3 });
      try {
        expect(
          await PROCESSORS['market-byok'].create(depsOf(restarted, { eodhd: answering('eodhd', '8750', inputs) }))({
            id: 'mkb',
            data: { userId: ayu },
            attemptsMade: 1,
          }),
        ).toEqual({ markets: [] });
      } finally {
        await restarted.close();
      }
      expect(inputs).toHaveLength(1);
      expect(await count(`SELECT count(*) AS n FROM user_quotes`)).toBe(2);
    } finally {
      await connection.close();
    }
  });

  it('pauses the key after a 429 until Retry-After and keeps the last prices', async () => {
    const connection = openWorkerDb(urlAs(ROLES.worker, PASSWORDS.worker), keyring, { s3: FAKE_S3 });
    try {
      const inputs: FetchQuotesInput[] = [];
      // 14.35 WIB: the 14.30 refresh is due.
      const at = new Date('2026-10-15T07:35:00Z');
      const limited = depsOf(connection, { eodhd: answering('eodhd', '1', inputs, LIMITED) }, at);
      await PROCESSORS['market-byok'].create(limited)({ id: 'mkb', data: { userId: ayu }, attemptsMade: 0 });
      const [key] = await superuser<{ status: string; retry_after: Date }[]>`
        SELECT status::text, retry_after FROM market_credentials WHERE user_id = ${ayu}`;
      expect(key).toEqual({ status: 'rate_limited', retry_after: new Date(at.getTime() + 600_000) });
      // Five minutes later (still paused): not asked.
      const later = depsOf(connection, { eodhd: answering('eodhd', '1', inputs) }, new Date(at.getTime() + 300_000));
      expect(
        await PROCESSORS['market-byok'].create(later)({ id: 'mkb', data: { userId: ayu }, attemptsMade: 0 }),
      ).toEqual({
        markets: [],
      });
      expect(inputs).toHaveLength(1);
      expect(await count(`SELECT count(*) AS n FROM user_quotes WHERE price = 8750`)).toBe(2);
    } finally {
      await connection.close();
    }
  });
});

describe('snapshots', () => {
  it('records one row per user and local date, also when run again', async () => {
    const connection = openWorkerDb(urlAs(ROLES.worker, PASSWORDS.worker), keyring, { s3: FAKE_S3 });
    try {
      const snapshots = PROCESSORS.snapshots.create(depsOf(connection, {}, new Date('2026-10-15T16:55:00Z')));
      expect(await snapshots({ id: 's', data: { userId: ayu }, attemptsMade: 0 })).toEqual({
        snapshot: { date: '2026-10-15' },
      });
      await snapshots({ id: 's', data: { userId: ayu }, attemptsMade: 1 });
      expect(await count(`SELECT count(*) AS n FROM portfolio_snapshots WHERE user_id = '${ayu}'`)).toBe(1);
    } finally {
      await connection.close();
    }
  });
});
