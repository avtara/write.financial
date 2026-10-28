// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The M8 performance budget (docs/IMPLEMENTATION_PLAN.md §M8: "p95 TTFB < 300 ms with 10,000 transactions"):
 * `pnpm test:perf` (builds first) or `pnpm --filter @wf/web test:perf` (against the existing `.output`).
 *
 * 1. Starts Postgres 18 and Valkey in Testcontainers of its own (never the dev stack or `wf_e2e`), creates the roles,
 *    applies every migration, and completes the instance setup (open registration, no setup wizard).
 * 2. Starts the production server (`.output/server/index.mjs`) on {@link PORT}, on the E2E clock (`e2e/clock.ts`:
 *    "now" is E2E_NOW, the design persona's day) with the fake market/AI providers, pinned to {@link CPUS} with
 *    `taskset` where it exists (the production VPS has 2 vCPU). Postgres gets a 2-CPU quota.
 * 3. Signs a user up over HTTP (the session cookie the measurement sends), loads the design persona
 *    (`seedLedger` + `seedAutomation`), and records generated transactions through the transactions repository
 *    until the user has {@link TRANSACTIONS} live ones: one deterministic year of expenses, incomes, and transfers on
 *    the persona's IDR accounts, categories, and tags, ending on E2E_NOW.
 * 4. Requests every page of {@link PAGES} {@link WARMUP} times, then {@link SAMPLES} times round-robin, one request at
 *    a time with a keep-alive connection, and prints p50/p95 TTFB (response headers received) and full response time
 *    per page. Exits 1 when a page's p95 TTFB reaches {@link BUDGET_MS}.
 *
 * Settings (environment): WF_PERF_PORT (31900), WF_PERF_SAMPLES (50), WF_PERF_WARMUP (5), WF_PERF_TRANSACTIONS
 * (10000), WF_PERF_CPUS (`0,1`; empty = unpinned), WF_PERF_BUDGET_MS (300), WF_PERF_OUT (a JSON report path),
 * WF_PERF_SQL_LOG (a file for Postgres' log, with every statement of at least WF_PERF_SQL_MS, default 10, and its
 * duration: where a slow page spends its time), WF_PERF_HOLD=1 (once the ledger is loaded, waits for Enter before
 * measuring and prints the superuser URL, the user's id, and the session cookie: EXPLAIN ANALYZE and requests of
 * one's own against the generated ledger).
 * Outside `src`, so it carries no unit-coverage duty, like the E2E support code.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { Agent, get } from 'node:http';
import { cpus, tmpdir, totalmem } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { ValkeyContainer } from '@testcontainers/valkey';
import type { Dek } from '@wf/crypto/envelope';
import { createKeyFile, loadKeyring } from '@wf/crypto/keyring';
import { createCategories } from '@wf/db/categories';
import { createDb, type Database } from '@wf/db/db';
import { migrate } from '@wf/db/migrate';
import { bootstrapRoles, ROLES, type RoleName } from '@wf/db/roles';
import { seedAutomation, seedLedger } from '@wf/db/seed';
import type { TransactionDraft } from '@wf/db/ledger-core';
import { createTransactions } from '@wf/db/transactions';
import { createUserKeys } from '@wf/db/user-keys';
import postgres from 'postgres';
import { E2E_NOW } from '../e2e/env.ts';
import { exampleEnv } from '../test/env.ts';

const setting = (key: string, fallback: string): string => process.env[key] ?? fallback;
const PORT = Number(setting('WF_PERF_PORT', '31900'));
const SAMPLES = Number(setting('WF_PERF_SAMPLES', '50'));
const WARMUP = Number(setting('WF_PERF_WARMUP', '5'));
const TRANSACTIONS = Number(setting('WF_PERF_TRANSACTIONS', '10000'));
const CPUS = setting('WF_PERF_CPUS', '0,1');
const BUDGET_MS = Number(setting('WF_PERF_BUDGET_MS', '300'));
const OUT = process.env['WF_PERF_OUT'];
const SQL_LOG = process.env['WF_PERF_SQL_LOG'];
const SQL_MS = setting('WF_PERF_SQL_MS', '10');
const HOLD = process.env['WF_PERF_HOLD'] === '1';
const BASE_URL = `http://localhost:${String(PORT)}`;
const WEB_DIR = path.resolve(import.meta.dirname, '..');
/** The client address the server sees (`x-forwarded-for`, as Caddy sends it in production). */
const CLIENT_IP = '198.51.100.90';

/** The generated year ends the day before E2E_NOW (15 Okt 2026) and starts 365 days earlier. */
const YEAR_TO = '2026-10-15';
const YEAR_FROM = '2025-10-16';

/** The signed-in pages of the budget; `?range=` over the generated year where the page takes one. */
const PAGES = [
  '/',
  '/?scope=year',
  '/transactions',
  `/transactions?range=${YEAR_FROM}..${YEAR_TO}`,
  '/budget',
  '/calendar',
  '/calendar?view=year',
  '/reports',
  '/investments',
  '/goals',
  '/subscriptions',
  '/accounts',
  '/debts',
  '/review',
] as const;

// The run's clock, as in `playwright.config.ts`: this process (seed, generated dates), the server, and Postgres all
// see E2E_NOW plus the real time elapsed since, so the persona's open period is the designed one.
const offset = Date.parse(E2E_NOW) - Date.now();
process.env['WF_E2E_CLOCK_OFFSET_MS'] = String(offset);
// Dynamic: the clock module reads the offset when it loads, and static imports would load it before it is set.
await import('../e2e/clock.ts');

const secret = (label: string) => `${label}-${randomBytes(12).toString('hex')}`;
const ROLE_PASSWORDS = {
  app: secret('app'),
  worker: secret('worker'),
  migrate: secret('migrate'),
  auth: secret('auth'),
  readonlyOps: null,
};
const USER = { name: 'Perf Persona', email: 'perf@perf.test', password: secret('Perf-password') };

/** Deterministic PRNG (mulberry32), so every run generates the same ledger. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? Number.NaN;
}

const tmp = mkdtempSync(path.join(tmpdir(), 'wf-perf-'));
const KEK_FILE = path.join(tmp, 'kek');
let server: ChildProcess | undefined;
const cleanups: (() => Promise<unknown>)[] = [];
// Killed from outside (e.g. `timeout`): never leave the server behind; Testcontainers' reaper stops the containers.
process.once('SIGTERM', () => {
  server?.kill('SIGKILL');
  process.exit(143);
});

async function main(): Promise<number> {
  console.log(`Starting Postgres and Valkey (Testcontainers)…`);
  const [pg, valkey] = await Promise.all([
    (SQL_LOG === undefined
      ? new PostgreSqlContainer('postgres:18.6')
      : new PostgreSqlContainer('postgres:18.6')
          .withCommand(['postgres', '-c', `log_min_duration_statement=${SQL_MS}`])
          .withLogConsumer((stream) => stream.pipe(createWriteStream(SQL_LOG)))
    )
      .withResourcesQuota({ cpu: 2 })
      .start(),
    new ValkeyContainer('valkey/valkey:9.2').withPassword(secret('valkey')).start(),
  ]);
  cleanups.push(
    () => pg.stop(),
    () => valkey.stop(),
  );
  const urlAs = (role: RoleName, password: string) => {
    const url = new URL(pg.getConnectionUri());
    url.username = role;
    url.password = password;
    return url.href;
  };
  const superuser = postgres(pg.getConnectionUri(), { max: 1, onnotice: () => undefined });
  cleanups.push(() => superuser.end());

  await bootstrapRoles(pg.getConnectionUri(), ROLE_PASSWORDS);
  // Postgres on the run's clock, exactly as `e2e/prepare.ts` shifts `wf_e2e`.
  await superuser.unsafe(
    `CREATE FUNCTION public.now() RETURNS timestamptz LANGUAGE sql STABLE PARALLEL SAFE
       AS $$ SELECT pg_catalog.now() + interval '${String(Math.round(offset))} milliseconds' $$`,
  );
  await superuser.unsafe(`ALTER DATABASE ${pg.getDatabase()} SET search_path = "$user", public, pg_catalog`);
  await migrate(urlAs(ROLES.migrate, ROLE_PASSWORDS.migrate));
  // The setup wizard's outcome without an admin: the instance is set up and anyone may sign up.
  await superuser`
    UPDATE instance_settings SET setup_completed_at = now(), registration_mode = 'open', public_url = ${BASE_URL}`;
  await createKeyFile(KEK_FILE);

  const env = exampleEnv({
    NODE_ENV: 'production',
    PORT: String(PORT),
    PUBLIC_URL: BASE_URL,
    LOG_LEVEL: 'warn',
    DATABASE_URL: urlAs(ROLES.app, ROLE_PASSWORDS.app),
    DATABASE_URL_WORKER: urlAs(ROLES.worker, ROLE_PASSWORDS.worker),
    DATABASE_URL_AUTH: urlAs(ROLES.auth, ROLE_PASSWORDS.auth),
    DATABASE_URL_MIGRATE: urlAs(ROLES.migrate, ROLE_PASSWORDS.migrate),
    DATABASE_URL_SUPERUSER: pg.getConnectionUri(),
    REDIS_URL: valkey.getConnectionUrl(),
    // Nothing on the measured pages reaches object storage or SMTP; closed ports keep the dev stack out of it.
    S3_ENDPOINT: 'http://127.0.0.1:9',
    SMTP_URL: 'smtp://127.0.0.1:9',
    KEK_FILE,
    AUTH_SECRET: secret('auth-secret'),
    SETUP_TOKEN: secret('setup-token'),
    WF_E2E_CLOCK_OFFSET_MS: String(offset),
  });
  delete env['DATABASE_URL_READONLY_OPS'];
  const pinned = CPUS !== '' && spawnSync('taskset', ['--version']).status === 0;
  const node = [
    '--import',
    './e2e/clock.ts',
    '--import',
    './e2e/market-fetch.ts',
    '--import',
    './e2e/ai-fetch.ts',
    '.output/server/index.mjs',
  ];
  const taken = await fetch(`${BASE_URL}/healthz`).then(
    () => true,
    () => false,
  );
  if (taken) throw new Error(`Port ${String(PORT)} is in use; stop that server or set WF_PERF_PORT`);
  console.log(`Starting the production server on ${BASE_URL} (${pinned ? `CPUs ${CPUS}` : 'unpinned'})…`);
  server = spawn(pinned ? 'taskset' : process.execPath, pinned ? ['-c', CPUS, process.execPath, ...node] : node, {
    cwd: WEB_DIR,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  await waitForHealth();

  const cookie = await signUp();
  const userId = (await superuser<{ id: string }[]>`SELECT id FROM users WHERE email = ${USER.email}`)[0]?.id;
  if (userId === undefined) throw new Error('The signed-up user is missing');

  console.log('Loading the design persona…');
  const keyring = await loadKeyring(KEK_FILE);
  const app = createDb(urlAs(ROLES.app, ROLE_PASSWORDS.app), { max: 4 });
  const worker = createDb(urlAs(ROLES.worker, ROLE_PASSWORDS.worker), { max: 1 });
  cleanups.push(
    () => app.$client.end(),
    () => worker.$client.end(),
  );
  const getDek = createUserKeys(app, keyring).getOrCreateDek;
  await seedLedger(app, userId, { getDek });
  await seedAutomation(worker, userId, { getDek: createUserKeys(worker, keyring).getOrCreateDek });

  const live = async () =>
    Number(
      (
        await superuser<{ n: string }[]>`
          SELECT count(*) AS n FROM transactions WHERE user_id = ${userId} AND deleted_at IS NULL`
      )[0]?.n,
    );
  const missing = TRANSACTIONS - (await live());
  console.log(`Recording ${String(missing)} generated transactions…`);
  const started = performance.now();
  await generate(app, userId, getDek, missing, superuser);
  const total = await live();
  console.log(`${String(total)} live transactions (${((performance.now() - started) / 1000).toFixed(0)} s).`);
  await superuser.unsafe('VACUUM ANALYZE');

  if (HOLD) {
    // For EXPLAIN ANALYZE as the app runs it (`SET ROLE wf_app; SELECT set_config('app.user_id', '<id>', false);`)
    // and for requests of one's own with the session cookie. Enter, not Ctrl-C: the server shares the terminal's
    // process group, so a SIGINT would stop it as well.
    console.log(`Holding until Enter: ${pg.getConnectionUri()} user ${userId} cookie ${cookie}`);
    await once(process.stdin, 'data');
    process.stdin.pause();
  }
  const results = await measure(cookie);
  const machine = {
    cpu: cpus()[0]?.model ?? 'unknown',
    logicalCpus: cpus().length,
    memoryGiB: Math.round(totalmem() / 2 ** 30),
    node: process.version,
    serverCpus: pinned ? CPUS : 'unpinned',
    postgresCpuQuota: 2,
  };
  const settings = { transactions: total, samples: SAMPLES, warmup: WARMUP, budgetMs: BUDGET_MS };
  console.log(`\n${JSON.stringify({ machine, settings })}\n`);
  console.log('| Page | p50 TTFB | p95 TTFB | p95 full | max TTFB |');
  console.log('|---|---:|---:|---:|---:|');
  const over: string[] = [];
  for (const { page, p50, p95, p95Full, max } of results) {
    console.log(
      `| \`${page}\` | ${p50.toFixed(0)} ms | ${p95.toFixed(0)} ms | ${p95Full.toFixed(0)} ms | ${max.toFixed(0)} ms |`,
    );
    if (p95 >= BUDGET_MS) over.push(page);
  }
  if (OUT !== undefined) {
    mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify({ machine, settings, results }, null, 2)}\n`);
  }
  if (over.length > 0) {
    console.error(`\np95 TTFB ≥ ${String(BUDGET_MS)} ms: ${over.join(', ')}`);
    return 1;
  }
  console.log(`\nEvery page's p95 TTFB is below ${String(BUDGET_MS)} ms.`);
  return 0;
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null) throw new Error('The production server exited; run `pnpm --filter @wf/web build`');
    try {
      if ((await fetch(`${BASE_URL}/healthz`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The production server did not answer /healthz within 60 s');
}

/** Email sign-up through Better Auth (`autoSignIn`): the session cookies of the measured requests. */
async function signUp(): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE_URL, 'x-forwarded-for': CLIENT_IP },
    body: JSON.stringify(USER),
  });
  if (!response.ok) throw new Error(`Sign-up failed with ${String(response.status)}: ${await response.text()}`);
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
}

/**
 * Records `count` transactions over the generated year through the repository (as the Record sheet does): 85%
 * expenses on the IDR accounts in the persona's expense categories, 8% incomes, 7% transfers between IDR accounts,
 * a third of them with one or two of eight tags. Eight writers run at a time.
 */
async function generate(
  db: Database,
  userId: string,
  getDek: (userId: string) => Promise<Dek>,
  count: number,
  superuser: postgres.Sql,
): Promise<void> {
  const next = random(20261015);
  const pick = <T>(values: readonly T[]): T => {
    const value = values[Math.floor(next() * values.length)];
    if (value === undefined) throw new Error('Nothing to pick from');
    return value;
  };
  const accounts = (
    await superuser<{ id: string }[]>`
      SELECT id::text FROM accounts WHERE user_id = ${userId} AND currency = 'IDR' AND type <> 'investment'`
  ).map((row) => row.id);
  const categories = await createCategories(db, { getDek }).list(userId);
  const expenses = categories.filter((category) => category.kind === 'expense').map((category) => category.id);
  const incomes = categories.filter((category) => category.kind === 'income').map((category) => category.id);
  const tags = ['makan', 'kantor', 'keluarga', 'liburan', 'anak', 'kesehatan', 'rumah', 'hobi'];
  const merchants = ['Indomaret', 'Alfamart', 'GrabFood', 'Gojek', 'Tokopedia', 'Shopee', 'Kopi Kenangan', 'Pertamina'];
  // The seed's closed period (September) refuses new rows: those days keep only the persona's transactions.
  const closed = await superuser<{ first: string; last: string }[]>`
    SELECT start_date::text AS first, end_date::text AS last FROM periods WHERE user_id = ${userId} AND status = 'closed'`;
  const from = Date.parse(`${YEAR_FROM}T00:00:00+07:00`);
  const span = Date.parse(`${YEAR_TO}T00:00:00+07:00`) - from;
  const drafts: TransactionDraft[] = [];
  while (drafts.length < count) {
    const occurredAt = new Date(from + Math.floor(next() * span));
    // The persona's timezone is Asia/Jakarta (UTC+7, no DST).
    const day = new Date(occurredAt.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
    if (closed.some((period) => period.first <= day && day <= period.last)) continue;
    const roll = next();
    const chosen = next() < 1 / 3 ? [pick(tags), ...(next() < 0.3 ? [pick(tags)] : [])] : [];
    const common = { clientId: randomUUID(), occurredAt, tags: [...new Set(chosen)] };
    // Rp5.000–Rp500.000 in steps of Rp100.
    const amountMinor = BigInt(50 + Math.floor(next() * 4_951)) * 100n;
    if (roll < 0.07) {
      const fromAccountId = pick(accounts);
      const toAccountId = pick(accounts.filter((id) => id !== fromAccountId));
      drafts.push({
        ...common,
        type: 'transfer',
        fromAccountId,
        toAccountId,
        sentMinor: amountMinor,
        receivedMinor: amountMinor,
        description: 'Pindah dana',
      });
    } else {
      const income = roll < 0.15;
      drafts.push({
        ...common,
        type: income ? 'income' : 'expense',
        accountId: pick(accounts),
        amountMinor: income ? amountMinor * 10n : amountMinor,
        categoryId: pick(income ? incomes : expenses),
        merchant: income ? null : pick(merchants),
        description: income ? 'Pemasukan' : pick(merchants),
      });
    }
  }
  const transactions = createTransactions(db, { getDek });
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (cursor < drafts.length) {
        const draft = drafts[cursor++];
        if (draft !== undefined) await transactions.create(userId, draft);
      }
    }),
  );
}

interface PageResult {
  readonly page: string;
  readonly p50: number;
  readonly p95: number;
  readonly p95Full: number;
  readonly max: number;
}

interface Timing {
  readonly status: number;
  readonly ttfb: number;
  readonly full: number;
}

/** One GET with the session: milliseconds to the response headers (TTFB) and to the last body byte. */
function request(agent: Agent, page: string, cookie: string): Promise<Timing> {
  const { promise, resolve, reject } = Promise.withResolvers<Timing>();
  const started = performance.now();
  const headers = { cookie, accept: 'text/html', 'x-forwarded-for': CLIENT_IP };
  get(`${BASE_URL}${page}`, { agent, headers }, (response) => {
    const ttfb = performance.now() - started;
    response.resume();
    response.on('end', () => {
      resolve({ status: response.statusCode ?? 0, ttfb, full: performance.now() - started });
    });
    response.on('error', reject);
  }).on('error', reject);
  return promise;
}

async function measure(cookie: string): Promise<PageResult[]> {
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  console.log(`Warming up (${String(WARMUP)} rounds)…`);
  for (let round = 0; round < WARMUP; round++) {
    for (const page of PAGES) {
      const { status } = await request(agent, page, cookie);
      if (status !== 200) throw new Error(`${page} answered ${String(status)}, not 200`);
    }
  }
  console.log(`Measuring (${String(SAMPLES)} rounds over ${String(PAGES.length)} pages)…`);
  const samples = new Map<string, { ttfb: number[]; full: number[] }>(
    PAGES.map((page) => [page, { ttfb: [], full: [] }]),
  );
  for (let round = 0; round < SAMPLES; round++) {
    for (const page of PAGES) {
      const { status, ttfb, full } = await request(agent, page, cookie);
      if (status !== 200) throw new Error(`${page} answered ${String(status)}, not 200`);
      samples.get(page)?.ttfb.push(ttfb);
      samples.get(page)?.full.push(full);
    }
  }
  agent.destroy();
  return [...samples].map(([page, { ttfb, full }]) => {
    const sorted = ttfb.toSorted((a, b) => a - b);
    return {
      page,
      p50: percentile(sorted, 0.5),
      p95: percentile(sorted, 0.95),
      p95Full: percentile(
        full.toSorted((a, b) => a - b),
        0.95,
      ),
      max: sorted.at(-1) ?? Number.NaN,
    };
  });
}

try {
  process.exitCode = await main();
} finally {
  // The server goes first, so it does not log reconnects to the containers being stopped.
  if (server !== undefined && server.exitCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    // srvx waits up to 5 s for open connections; never leave the server running.
    const forced = setTimeout(() => server?.kill('SIGKILL'), 10_000);
    await exited;
    clearTimeout(forced);
  }
  for (const cleanup of cleanups.reverse()) await cleanup().catch(() => undefined);
  rmSync(tmp, { recursive: true, force: true });
}
