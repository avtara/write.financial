// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The harness of the API isolation test (`src/server/fn/isolation.integration.test.ts`): the containers, the real
 * services, admin A (setup wizard) and invited user B with their sessions and data ({@link setUp}), the server
 * functions by name ({@link FUNCTIONS}, {@link as}), and the helpers the cases in `cases/<module>.ts` share. Outside
 * `src`, so it carries no unit-coverage duty; the integration test runs every line of it.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { type StartedValkeyContainer, ValkeyContainer } from '@testcontainers/valkey';
import { loadConfig } from '@wf/config';
import { createKeyFile, loadKeyring } from '@wf/crypto/keyring';
import { createDb, type Database, withUser } from '@wf/db/db';
import type { ManualRateInput } from '@wf/db/fx-rates';
import { migrate } from '@wf/db/migrate';
import { insertNotificationIn } from '@wf/db/notifications';
import { createOccurrenceJobs } from '@wf/db/occurrence-jobs';
import { bootstrapRoles, type RoleName, ROLES } from '@wf/db/roles';
import { createUserKeys } from '@wf/db/user-keys';
import { pino } from 'pino';
import postgres from 'postgres';
import { SMTPServer } from 'smtp-server';
import { expect, vi } from 'vitest';
import type { Result } from '../../src/server/access.ts';
import * as account from '../../src/server/fn/account.ts';
import * as accounts from '../../src/server/fn/accounts.ts';
import * as admin from '../../src/server/fn/admin.ts';
import * as budgetWrite from '../../src/server/fn/budget-write.ts';
import * as budget from '../../src/server/fn/budget.ts';
import { getCalendarRange, getCalendarYear } from '../../src/server/fn/calendar.ts';
import * as categories from '../../src/server/fn/categories.ts';
import * as debts from '../../src/server/fn/debts.ts';
import * as gate from '../../src/server/fn/gate.ts';
import * as goals from '../../src/server/fn/goals.ts';
import * as importFn from '../../src/server/fn/import.ts';
import * as investments from '../../src/server/fn/investments.ts';
import * as ledger from '../../src/server/fn/ledger.ts';
import * as market from '../../src/server/fn/market.ts';
import * as notifications from '../../src/server/fn/notifications.ts';
import {
  finishOnboarding,
  getOnboarding,
  saveOnboardingAccounts,
  saveOnboardingGoal,
  saveOnboardingPeriod,
  saveOnboardingProfile,
  skipOnboardingGoal,
} from '../../src/server/fn/onboarding.ts';
import * as receivables from '../../src/server/fn/receivables.ts';
import * as reports from '../../src/server/fn/reports.ts';
import * as review from '../../src/server/fn/review.ts';
import * as schedules from '../../src/server/fn/schedules.ts';
import * as search from '../../src/server/fn/search.ts';
import * as setup from '../../src/server/fn/setup.ts';
import * as tags from '../../src/server/fn/tags.ts';
import {
  listDrafts,
  listTransactionDays,
  recordTransaction,
  removeDraft,
  removeTransactions,
  restoreTransactions,
  saveDraft,
} from '../../src/server/fn/transactions-write.ts';
import {
  addAttachment,
  bulkAddTag,
  bulkMoveAccount,
  bulkSetCategory,
  countPeriodTransactions,
  duplicateTransaction,
  getTransactionDetail,
  getTransactionsView,
  listTransactionRows,
  removeAttachment,
  saveTablePrefs,
  splitTransaction,
  unsplitTransaction,
  updateTransaction,
} from '../../src/server/fn/transactions.ts';
import { getPreferences } from '../../src/server/get-preferences.ts';
import { createServices, type Services } from '../../src/server/runtime.ts';
import { SessionBrowser } from '../session-browser.ts';

/** `YYYY-MM-DD` as the repositories' branded date type. */
export type LocalDate = ManualRateInput['asOf'];

/** Built at runtime so no fixture looks like a committed secret. */
export const secret = (label: string) => `${label}-${randomBytes(12).toString('hex')}`;
const ROLE_PASSWORDS = {
  app: secret('app'),
  worker: secret('worker'),
  migrate: secret('migrate'),
  auth: secret('auth'),
  readonlyOps: null,
};
export const ORIGIN = 'http://localhost:3000';
const AUTH_SECRET = secret('auth-secret');
export const SETUP_TOKEN = secret('setup-token');
const SMTP_PASSWORD = secret('smtp');
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';

const A = { name: 'Avtara K.', email: 'avtara@example.test', password: secret('password-a') };
export const B = { name: 'Budi Santoso', email: 'budi@example.test', password: secret('password-b') };
export const INSTANCE_NAME = 'Keuangan Keluarga';

const tmp = mkdtempSync(path.join(tmpdir(), 'wf-web-isolation-'));
const KEK_FILE = path.join(tmp, 'kek');

let pg: StartedPostgreSqlContainer;
let valkey: StartedValkeyContainer;
export let superuser: postgres.Sql;
/** `wf_worker`, for the rows only the worker writes (notifications, due occurrences, review items). */
let workerDb: Database;
/** `wf_app`, for the users' DEKs the worker's occurrences job needs. */
let appDb: Database;
export let services: Services;
const smtp = new SMTPServer({
  authOptional: true,
  allowInsecureAuth: true,
  disabledCommands: ['STARTTLS'],
  onAuth: (auth, _session, callback) => {
    callback(null, { user: auth.username });
  },
  onData: (stream, session, callback) => {
    stream.resume();
    stream.on('end', () => {
      mail.push(session.envelope.rcptTo.map((rcpt) => rcpt.address).join(','));
      callback();
    });
  },
});
/** Recipients of every message the stub SMTP server accepted. */
const mail: string[] = [];
let smtpPort = 0;

/** The server functions the isolation test imports; its `MATRIX` must have a case for each. */
export const FUNCTIONS = {
  ...account,
  ...importFn,
  ...accounts,
  ...admin,
  ...budget,
  ...budgetWrite,
  ...categories,
  ...debts,
  ...gate,
  ...goals,
  ...investments,
  ...ledger,
  ...market,
  ...notifications,
  ...receivables,
  ...reports,
  ...review,
  ...schedules,
  ...search,
  ...setup,
  ...tags,
  getCalendarRange,
  getCalendarYear,
  recordTransaction,
  removeTransactions,
  restoreTransactions,
  listTransactionDays,
  saveDraft,
  listDrafts,
  removeDraft,
  getPreferences,
  getTransactionsView,
  listTransactionRows,
  getTransactionDetail,
  updateTransaction,
  duplicateTransaction,
  splitTransaction,
  unsplitTransaction,
  bulkSetCategory,
  bulkMoveAccount,
  bulkAddTag,
  addAttachment,
  removeAttachment,
  saveTablePrefs,
  countPeriodTransactions,
  getOnboarding,
  saveOnboardingProfile,
  saveOnboardingPeriod,
  saveOnboardingAccounts,
  saveOnboardingGoal,
  skipOnboardingGoal,
  finishOnboarding,
};
export type Name = keyof typeof FUNCTIONS;

type Caller = 'A' | 'B' | 'anonymous';
export const browsers = {} as Record<Caller, SessionBrowser>;
let a2: SessionBrowser;
export let b2: SessionBrowser;
export let aId: string;
export let bId: string;
export let aAccountId: string;
export let bAccountId: string;
/** A's expense (on {@link A_DAY}) and draft, which B must neither see nor change. */
export let aTransactionId: string;
export let aDraftId: string;
/** The idempotency key of A's expense; B reusing it must still record B's own transaction. */
export const A_CLIENT_ID = randomUUID();
export const A_DAY = '2026-10-05';
export const B_DAY = '2026-10-07';
/** Plaintext secrets no response may contain (stored ciphertexts and hashes are added in the final scan). */
export const secrets: string[] = [AUTH_SECRET, SETUP_TOKEN, SMTP_PASSWORD, A.password, B.password];
/** Every server function response, for the final scan. */
export const responses: { caller: Caller; fn: Name; value: unknown }[] = [];

/** Calls the server function `fn` as `caller` and records the response. */
export async function as<T>(caller: Caller, fn: Name, data?: unknown): Promise<T> {
  const value = await browsers[caller].call<T>(FUNCTIONS[fn], data);
  responses.push({ caller, fn, value });
  return value;
}

const urlAs = (role: RoleName, password: string) => {
  const url = new URL(pg.getConnectionUri());
  url.username = role;
  url.password = password;
  return url.href;
};

export const sessionIds = async (userId: string) =>
  (await superuser<{ id: string }[]>`SELECT id FROM sessions WHERE user_id = ${userId} ORDER BY id`).map((r) => r.id);
export const eventIds = async (userId: string) =>
  (await superuser<{ id: string }[]>`SELECT id FROM security_events WHERE user_id = ${userId} ORDER BY id DESC`).map(
    (r) => r.id,
  );
export const profileRow = async (userId: string) =>
  (await superuser`SELECT name, nickname, locale, timezone FROM users WHERE id = ${userId}`)[0];
const instanceRow = async () => (await superuser`SELECT * FROM instance_settings`)[0];
export const count = async (table: string, where = 'true') =>
  Number((await superuser.unsafe<{ n: string }[]>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`))[0]?.n);
export const currentSessionId = async (browser: SessionBrowser) => (await browser.session())?.session.id;
/** Ids of a user's rows in the ledger and M3 tables the read functions return. */
export const ledgerIds = async (userId: string) =>
  (
    await superuser<{ id: string }[]>`
      SELECT id::text FROM accounts WHERE user_id = ${userId}
      UNION ALL SELECT id::text FROM categories WHERE user_id = ${userId}
      UNION ALL SELECT id::text FROM tags WHERE user_id = ${userId}
      UNION ALL SELECT id::text FROM fx_rates WHERE user_id = ${userId}
      UNION ALL SELECT id::text FROM periods WHERE user_id = ${userId}
      UNION ALL SELECT id::text FROM budget_versions WHERE user_id = ${userId}
      UNION ALL SELECT id::text FROM transactions WHERE user_id = ${userId}
      UNION ALL SELECT id::text FROM drafts WHERE user_id = ${userId}
      UNION ALL SELECT id::text FROM notifications WHERE user_id = ${userId}
      UNION ALL SELECT id::text FROM subscriptions WHERE user_id = ${userId}
      UNION ALL SELECT id::text FROM recurrences WHERE user_id = ${userId}
      UNION ALL SELECT id::text FROM scheduled_occurrences WHERE user_id = ${userId}
      UNION ALL SELECT id::text FROM review_items WHERE user_id = ${userId}
      UNION ALL SELECT id::text FROM debts WHERE user_id = ${userId}
      UNION ALL SELECT id::text FROM debt_installments WHERE user_id = ${userId}
      UNION ALL SELECT id::text FROM detected_recurring WHERE user_id = ${userId}
      UNION ALL SELECT id::text FROM goals WHERE user_id = ${userId}
      ORDER BY 1`
  ).map((row) => row.id);
/** A user's notifications as stored, oldest first. */
export const notificationRows = (userId: string) =>
  superuser<{ id: string; ref: string; read_at: Date | null }[]>`
    SELECT id::text, ref, read_at FROM notifications WHERE user_id = ${userId} ORDER BY id`;
/** Ids of a user's rows in `table` matching `where`, oldest first (ids are UUIDv7). */
export const idsOf = async (table: string, userId: string, where = 'true') =>
  (
    await superuser.unsafe<{ id: string }[]>(
      `SELECT id::text FROM ${table} WHERE user_id = $1 AND ${where} ORDER BY id`,
      [userId],
    )
  ).map((row) => row.id);
/** A's schedules, review items, candidates, and notifications as stored; B's M3 calls must leave them unchanged. */
export const aM3Rows = async () => ({
  subscriptions: await superuser`SELECT * FROM subscriptions WHERE user_id = ${aId} ORDER BY id`,
  recurrences: await superuser`SELECT * FROM recurrences WHERE user_id = ${aId} ORDER BY id`,
  occurrences: await superuser`SELECT * FROM scheduled_occurrences WHERE user_id = ${aId} ORDER BY id`,
  reviewItems: await superuser`SELECT * FROM review_items WHERE user_id = ${aId} ORDER BY id`,
  detected: await superuser`SELECT * FROM detected_recurring WHERE user_id = ${aId} ORDER BY id`,
  notifications: await superuser`SELECT * FROM notifications WHERE user_id = ${aId} ORDER BY id`,
});
/** The first id of A's rows in `table` (they exist from the setup). */
export const firstOfA = async (table: string) => (await idsOf(table, aId))[0] ?? '';
/** JSON for the leak scan; ledger amounts are bigints. */
export const toJson = (value: unknown) =>
  JSON.stringify(value, (_key, child: unknown) => (typeof child === 'bigint' ? child.toString() : child));
/** A's ledger and M3 rows, all with names B must never see. */
export const A_LEDGER = {
  account: 'Rekening Rahasia A',
  category: 'Rahasia A',
  tag: 'rahasia-a',
  transaction: 'Belanja Rahasia A',
  note: 'Catatan Rahasia A',
  draft: 'Draf Rahasia A',
  subscription: 'Langganan Rahasia A',
  recurrence: 'Kos Rahasia A',
  detected: 'Toko Rahasia A',
  goal: 'Tujuan Rahasia A',
};
/** Whether transaction `id` is soft-deleted. */
export const isDeleted = async (id: string) =>
  (
    await superuser<{ deleted: boolean }[]>`SELECT deleted_at IS NOT NULL AS deleted FROM transactions WHERE id = ${id}`
  )[0]?.deleted;
/** The stored (encrypted) payload of draft `id`, or `undefined` when it is gone. */
export const draftPayload = async (id: string) =>
  (await superuser<{ payload: string }[]>`SELECT encode(payload_enc, 'hex') AS payload FROM drafts WHERE id = ${id}`)[0]
    ?.payload;
/** The id of a user's live category or tag by its stored name or slug. */
export const categoryId = async (userId: string, name: string) =>
  (
    await superuser<{ id: string }[]>`
      SELECT id::text FROM categories WHERE user_id = ${userId} AND name = ${name} AND deleted_at IS NULL`
  )[0]?.id ?? '';
export const tagId = async (userId: string, slug: string) =>
  (await superuser<{ id: string }[]>`SELECT id::text FROM tags WHERE user_id = ${userId} AND slug = ${slug}`)[0]?.id ??
  '';
/** A's categories, tags, and aliases as stored; B's category and tag writes must leave them unchanged. */
export const aLedgerRows = async () => ({
  categories: await superuser`SELECT * FROM categories WHERE user_id = ${aId} ORDER BY id`,
  tags: await superuser`SELECT * FROM tags WHERE user_id = ${aId} ORDER BY id`,
  aliases: await superuser`SELECT * FROM tag_aliases WHERE user_id = ${aId} ORDER BY id`,
  tagged: await superuser`SELECT tt.* FROM transaction_tags tt JOIN tags t ON t.id = tt.tag_id
    WHERE t.user_id = ${aId} ORDER BY 1, 2`,
});
/** A user's current period. */
export const currentPeriod = async (userId: string) => (await services.periods.list(userId)).current;
/** The category of the budget line each user gets in `beforeAll`. */
export const budgetedId = (userId: string) => categoryId(userId, `Anggaran ${userId === aId ? A_LEDGER.tag : 'tag-b'}`);
/** A second expense category for budget writes, so the line of {@link budgetedId} stays the only one between cases. */
export const spareId = async (userId: string) =>
  (await categoryId(userId, 'Anggaran cadangan')) ||
  (
    await services.categories.create(userId, {
      kind: 'expense',
      group: 'wants',
      name: 'Anggaran cadangan',
      icon: 'wallet',
      color: 'green',
    })
  ).id;
/** A's budgets, overrides, dismissed warnings, periods, and start day as stored; B's budget writes leave them alone. */
/** A user's FR-A4 progress and step data as stored (`users`, extra currencies, goals, recurrences). */
export const onboardingRows = async (userId: string) => ({
  user: (
    await superuser`
      SELECT onboarding_step, onboarding_completed_at, base_currency, name, nickname FROM users WHERE id = ${userId}`
  )[0],
  extras: await superuser`SELECT extra_currencies FROM user_preferences WHERE user_id = ${userId}`,
  goals: await superuser`SELECT * FROM goals WHERE user_id = ${userId} ORDER BY id`,
  recurrences: await superuser`SELECT * FROM recurrences WHERE user_id = ${userId} ORDER BY id`,
  budgets: await superuser`SELECT * FROM budget_versions WHERE user_id = ${userId} ORDER BY id`,
});
export const aBudgetRows = async () => ({
  versions: await superuser`SELECT * FROM budget_versions WHERE user_id = ${aId} ORDER BY id`,
  lines: await superuser`SELECT * FROM budget_lines WHERE user_id = ${aId} ORDER BY version_id, category_id`,
  overrides: await superuser`SELECT * FROM budget_period_overrides WHERE user_id = ${aId} ORDER BY id`,
  dismissals: await superuser`SELECT * FROM budget_alert_dismissals WHERE user_id = ${aId} ORDER BY 1, 2, 3`,
  periods: await superuser`SELECT * FROM periods WHERE user_id = ${aId} ORDER BY start_date`,
  preferences: await superuser`SELECT period_start_day, period_mode FROM user_preferences WHERE user_id = ${aId}`,
});
/** Any id: the signed-out request is refused before it is looked up. */
export const SOME_ID = '0192a6c4-0000-7000-8000-000000000000';
/** The id of a user's subscription by name, or `''`. */
export const subscriptionOf = async (userId: string, name: string) =>
  (await idsOf('subscriptions', userId, `name = '${name}'`))[0] ?? '';
/** B's weekly "Arisan B" recurrence paid from `accountId`. */
export const arisan = (accountId: string, amountMinor = 50_000n) => ({
  template: { type: 'expense', accountId, amountMinor, categoryId: null, description: 'Arisan B' },
  freq: 'weekly',
  startOn: '2026-11-02',
  end: { type: 'never' },
  remindOffsetDays: null,
});
export const arisanOfB = async () =>
  (await idsOf('recurrences', bId, `template->>'description' = 'Arisan B'`))[0] ?? '';
/** B's "Spotify B" subscription paid from `accountId`, first billed (and started) on `nextBillingDate`. */
export const spotify = (accountId: string, nextBillingDate: string) => ({
  name: 'Spotify B',
  priceMinor: 54_990n,
  currency: 'IDR',
  cycle: 'monthly',
  nextBillingDate,
  payFromAccountId: accountId,
  categoryId: null,
  startedOn: nextBillingDate,
});
/** A fixed range around both users' transactions, so the Transactions page cases do not depend on today. */
export const OCTOBER = '2026-10-01..2026-10-31';
/** B's "Kopi B" as the record form submits it, with `overrides`. */
export const bExpense = (overrides: object = {}) => ({
  type: 'expense',
  clientId: randomUUID(),
  occurredAt: new Date(`${B_DAY}T05:00:00Z`),
  accountId: bAccountId,
  amountMinor: 25_000n,
  categoryId: null,
  description: 'Kopi B',
  ...overrides,
});
export const transactionRow = async (id: string) =>
  (await superuser`SELECT user_id, description FROM transactions WHERE id = ${id}`)[0];

export const smtpInput = (password?: string) => ({
  host: '127.0.0.1',
  port: smtpPort,
  secure: false,
  username: 'mailer',
  ...(password === undefined ? {} : { password }),
  from: 'write.financial <noreply@wf.test>',
});
const instanceInput = () => ({
  instanceName: INSTANCE_NAME,
  publicUrl: `${ORIGIN}/`,
  defaultLocale: 'en',
  defaultTimezone: 'Asia/Makassar',
  registrationMode: 'invite',
  smtp: smtpInput(SMTP_PASSWORD),
});
/** What B tries to save as instance settings. */
export const hostileInstance = () => ({
  ...instanceInput(),
  instanceName: 'Pwned',
  registrationMode: 'open',
  smtp: null,
});

export const UNAUTHENTICATED = { ok: false, code: 'UNAUTHENTICATED' };
/** A's accounts with every field a write could change, and A's ledger row counts. */
export const aLedger = async () => ({
  accounts: await superuser`SELECT * FROM accounts WHERE user_id = ${aId} ORDER BY id`,
  transactions: await count('transactions', `user_id = '${aId}'`),
  adjustments: await count('balance_adjustments', `user_id = '${aId}'`),
});
/** Calls `fn` as B with `input` (aimed at A's account): refused as not found, A's ledger unchanged. */
export async function notFoundForB(fn: Name, input: unknown): Promise<void> {
  const before = await aLedger();
  expect(await as('B', fn, input)).toEqual(NOT_FOUND);
  expect(await aLedger()).toEqual(before);
}
export const bAccountNames = async () =>
  (
    await superuser<{ name: string; status: string }[]>`
    SELECT display_name AS name, status::text FROM accounts WHERE user_id = ${bId} ORDER BY sort_order, id`
  ).map((row) => `${row.name}:${row.status}`);
export const FORBIDDEN = { ok: false, code: 'FORBIDDEN' };
export const ok = <T>(value: T) => ({ ok: true, value });
export const NOT_FOUND = { ok: false, code: 'NOT_FOUND' };
export const INVALID_CATEGORY = { ok: false, code: 'INVALID_CATEGORY' };

/**
 * Starts Postgres and Valkey, the real services (`createServices`, handed to the mocked `runtime.ts` through
 * `running`), and the stub SMTP server; admin A runs the setup wizard and invites B; both get ledger, budget, M3
 * rows, and sessions on two devices.
 */
export async function setUp(running: { services: Promise<Services> | null }): Promise<void> {
  [pg, valkey] = await Promise.all([
    new PostgreSqlContainer('postgres:18.6').start(),
    new ValkeyContainer('valkey/valkey:9.2').withPassword(secret('valkey')).start(),
  ]);
  superuser = postgres(pg.getConnectionUri(), { max: 2, onnotice: () => undefined });
  await bootstrapRoles(pg.getConnectionUri(), ROLE_PASSWORDS);
  await migrate(urlAs(ROLES.migrate, ROLE_PASSWORDS.migrate));
  await createKeyFile(KEK_FILE);
  for (const line of readFileSync(KEK_FILE, 'utf8').split('\n')) {
    const key = /^v\d+:(\S+)$/.exec(line)?.[1];
    if (key !== undefined) secrets.push(key, Buffer.from(key, 'base64').toString('hex'));
  }
  smtp.listen(0, '127.0.0.1');
  await once(smtp.server, 'listening');
  smtpPort = (smtp.server.address() as AddressInfo).port;

  const config = loadConfig({
    NODE_ENV: 'test',
    PUBLIC_URL: ORIGIN,
    DATABASE_URL: urlAs(ROLES.app, ROLE_PASSWORDS.app),
    DATABASE_URL_WORKER: urlAs(ROLES.worker, ROLE_PASSWORDS.worker),
    DATABASE_URL_AUTH: urlAs(ROLES.auth, ROLE_PASSWORDS.auth),
    REDIS_URL: valkey.getConnectionUrl(),
    S3_ENDPOINT: 'http://127.0.0.1:8333',
    S3_ACCESS_KEY_ID: 'unused',
    S3_SECRET_ACCESS_KEY: secret('s3'),
    KEK_FILE,
    AUTH_SECRET,
    SETUP_TOKEN,
    LOG_LEVEL: 'silent',
  });
  // HIBP stays offline: the breached-password check captures `fetch` when created and fails open.
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
  running.services = createServices({
    config,
    logger: pino({ level: 'silent' }),
    localeStorage: new AsyncLocalStorage(),
  });
  services = await running.services;
  vi.unstubAllGlobals();
  const browser = (ip: string, userAgent: string) => new SessionBrowser(services.auth, ORIGIN, ip, userAgent);

  // A: the setup wizard, as the operator runs it.
  browsers.A = browser('198.51.100.1', FIREFOX);
  expect(await as('A', 'getSetup', { token: SETUP_TOKEN })).toMatchObject({ status: 'open', step: 'admin' });
  expect(
    await as('A', 'createSetupAdmin', { name: A.name, email: A.email, password: A.password, locale: 'id' }),
  ).toEqual(ok(null));
  await browsers.A.signIn(A.email, A.password);
  const enrolledA = await browsers.A.enrollTotp(A.password);
  secrets.push(enrolledA.totp.secret.base32, ...enrolledA.backupCodes);
  expect(await as('A', 'getSetup', {})).toMatchObject({ status: 'open', step: 'instance' });
  expect(await as('A', 'sendSetupTestEmail', smtpInput(SMTP_PASSWORD))).toEqual(ok(null));
  expect(await as('A', 'saveSetup', instanceInput())).toEqual(ok(null));
  aId = (await browsers.A.session())?.user.id ?? '';

  // B: invited by A, signs up with the invitation, enrolls TOTP, and signs in on a second device.
  const invited = await as<Result<{ url: string; emailed: boolean }>>('A', 'inviteUser', { email: B.email });
  expect(invited).toMatchObject({ ok: true, value: { emailed: true } });
  const invitationToken = invited.ok ? new URL(invited.value.url).searchParams.get('invitation') : null;
  browsers.B = browser('198.51.100.2', CHROME);
  expect(
    await browsers.B.request('/sign-up/email', { name: B.name, email: B.email, password: B.password, invitationToken }),
  ).toMatchObject({ status: 200, body: { user: { email: B.email } } });
  const enrolledB = await browsers.B.enrollTotp(B.password);
  secrets.push(enrolledB.totp.secret.base32, ...enrolledB.backupCodes);
  bId = (await browsers.B.session())?.user.id ?? '';
  b2 = browser('198.51.100.3', FIREFOX);
  await b2.signIn(B.email, B.password, enrolledB.totp);

  // A's second device, after B's events, so A has the newest security event.
  a2 = browser('198.51.100.4', CHROME);
  await a2.signIn(A.email, A.password, enrolledA.totp);

  // B and the signed-out visitor even hold the real setup token (as if it leaked).
  browsers.anonymous = browser('198.51.100.5', FIREFOX);
  browsers.B.cookies.set('wf_setup', encodeURIComponent(SETUP_TOKEN));
  browsers.anonymous.cookies.set('wf_setup', encodeURIComponent(SETUP_TOKEN));

  // Ledger rows of both users through the app's repositories; A's have names B must never see.
  for (const [userId, names] of [
    [aId, A_LEDGER],
    [bId, { account: 'Rekening B', category: 'Kategori B', tag: 'tag-b' }],
  ] as const) {
    const created = await services.accounts.create(userId, {
      type: 'bank',
      providerName: 'BCA',
      displayName: names.account,
      currency: 'IDR',
      openingBalanceMinor: 1_000_000n,
      openingDate: '2026-10-01' as LocalDate,
      color: 'blue',
    });
    if (userId === aId) aAccountId = created.id;
    else bAccountId = created.id;
    await services.categories.create(userId, {
      kind: 'expense',
      group: 'wants',
      name: names.category,
      icon: 'coffee',
      color: 'orange',
    });
    await services.tags.create(userId, names.tag);
    // M2: the current period and a budget line for a category no other case changes.
    const budgeted = await services.categories.create(userId, {
      kind: 'expense',
      group: 'needs',
      name: `Anggaran ${names.tag}`,
      icon: 'wallet',
      color: 'green',
    });
    const { current } = await services.periods.list(userId);
    await services.budgets.setLine(userId, current.id as string, { categoryId: budgeted.id, limitMinor: 500_000n });
  }
  await services.fxRates.upsertManual(aId, {
    base: 'USD',
    quote: 'IDR',
    rate: '16474',
    asOf: '2026-10-15' as LocalDate,
  });
  aTransactionId = (
    await services.transactions.create(aId, {
      type: 'expense',
      clientId: A_CLIENT_ID,
      occurredAt: new Date(`${A_DAY}T05:00:00Z`),
      accountId: aAccountId,
      amountMinor: 50_000n,
      categoryId: null,
      description: A_LEDGER.transaction,
      note: A_LEDGER.note,
      tags: [A_LEDGER.tag],
    })
  ).id;
  aDraftId = (await services.drafts.save(aId, { kind: 'transaction', payload: { description: A_LEDGER.draft } })).id;
  // M3: one notification each, written as the worker writes them; A's names an account B must never see.
  workerDb = createDb(urlAs(ROLES.worker, ROLE_PASSWORDS.worker));
  for (const [userId, name] of [
    [aId, A_LEDGER.account],
    [bId, 'Rekening B'],
  ] as const) {
    await withUser(workerDb, userId, (tx) =>
      insertNotificationIn(tx, userId, {
        type: 'low_balance',
        category: 'budget_bills',
        titleKey: 'notification_low_balance_title',
        bodyKey: 'notification_low_balance_body',
        params: { account: name },
        action: { href: '/accounts' },
        ref: `bal.${name}`,
      }),
    );
  }
  // M3 schedules billed today, put in review by the occurrences job (run as the worker): A has one subscription and
  // one recurrence with secret names; B has two subscriptions and a recurrence, so the review cases have three items.
  // Plus subscription candidates (written by the worker's detection job in production; inserted here).
  appDb = createDb(urlAs(ROLES.app, ROLE_PASSWORDS.app));
  const jobs = createOccurrenceJobs(workerDb, {
    getDek: createUserKeys(appDb, await loadKeyring(KEK_FILE)).getOrCreateDek,
  });
  for (const [userId, subscriptionNames, recurrenceName, detected] of [
    [aId, [A_LEDGER.subscription], A_LEDGER.recurrence, [A_LEDGER.detected]],
    [bId, ['Langganan B', 'Langganan B2'], 'Kos B', ['Vidio B', 'Gym B']],
  ] as const) {
    const { today } = await services.schedules.listSubscriptions(userId);
    const accountId = (await services.accounts.list(userId)).accounts[0]?.id ?? '';
    for (const name of subscriptionNames) {
      await services.schedules.createSubscription(userId, {
        name,
        priceMinor: 186_000n,
        currency: 'IDR',
        cycle: 'monthly',
        nextBillingDate: today,
        payFromAccountId: accountId,
        categoryId: null,
        remindDaysBefore: 1,
        startedOn: today,
      });
    }
    await services.schedules.createRecurrence(userId, {
      template: { type: 'expense', accountId, amountMinor: 3_500_000n, categoryId: null, description: recurrenceName },
      freq: 'monthly',
      startOn: today,
      end: { type: 'never' },
      remindOffsetDays: 1,
    });
    await jobs.advance(userId, new Date());
    for (const merchant of detected) {
      await superuser`
        INSERT INTO detected_recurring
          (user_id, merchant_key, merchant, day_of_month, amount_minor, currency, occurrences, last_seen_on, account_id)
        VALUES (${userId}, ${merchant.toLowerCase()}, ${merchant}, 5, 65900, 'IDR', 3, ${today}, ${accountId})`;
    }
  }
  expect(await idsOf('review_items', aId, `status = 'pending'`)).toHaveLength(2);
  expect(await idsOf('review_items', bId, `status = 'pending'`)).toHaveLength(3);

  expect(await count('users', `role = 'admin'`)).toBe(1);
  expect((await sessionIds(aId)).length).toBeGreaterThanOrEqual(2);
  expect((await eventIds(aId)).length).toBeGreaterThanOrEqual(1);
  expect((await sessionIds(bId)).length).toBeGreaterThanOrEqual(2);
  // Now, while every session row still exists (revoking deletes them).
  secrets.push(...(await storedSecrets()));
}

/** Stops what {@link setUp} started and deletes the temporary key file. */
export async function tearDown(): Promise<void> {
  smtp.close();
  await Promise.all([workerDb.$client.end(), appDb.$client.end()]);
  await superuser.end();
  await Promise.all([pg.stop(), valkey.stop()]);
  rmSync(tmp, { recursive: true, force: true });
}

/** Secrets as stored: TOTP secrets, backup codes, password hashes, session tokens, and encrypted or wrapped keys. */
export async function storedSecrets(): Promise<string[]> {
  const rows = await superuser<{ value: string }[]>`
    SELECT secret AS value FROM two_factors
    UNION ALL SELECT backup_codes FROM two_factors
    UNION ALL SELECT password FROM accounts_auth WHERE password IS NOT NULL
    UNION ALL SELECT token FROM sessions
    UNION ALL SELECT encode(dek_wrapped, 'hex') FROM user_keys
    UNION ALL SELECT replace(encode(dek_wrapped, 'base64'), E'\n', '') FROM user_keys
    UNION ALL SELECT encode(smtp_password_enc, 'hex') FROM instance_settings WHERE smtp_password_enc IS NOT NULL
    UNION ALL SELECT replace(encode(smtp_password_enc, 'base64'), E'\n', '') FROM instance_settings
      WHERE smtp_password_enc IS NOT NULL
    UNION ALL SELECT encode(instance_dek_wrapped, 'hex') FROM instance_settings WHERE instance_dek_wrapped IS NOT NULL`;
  // Two TOTP secrets and backup-code sets, two password hashes, at least three sessions, the SMTP password, the DEK.
  expect(rows.length).toBeGreaterThanOrEqual(10);
  return rows.map((row) => row.value);
}

/** A's data B must never see or change. */
export async function aSnapshot() {
  return {
    profile: await profileRow(aId),
    sessions: await sessionIds(aId),
    events: await eventIds(aId),
    signedIn: [await currentSessionId(browsers.A), await currentSessionId(a2)],
  };
}

/** The ids of A's rows; none may appear in a response to B or a signed-out visitor. */
export async function aIdentifiers(): Promise<string[]> {
  return [
    aId,
    A.email,
    A.name,
    ...Object.values(A_LEDGER),
    ...(await sessionIds(aId)),
    ...(await eventIds(aId)),
    ...(await ledgerIds(aId)),
  ];
}

export interface Case {
  /** The input, the same for B and the signed-out visitor. */
  readonly input?: () => unknown;
  /** The exact answer to a signed-out request. */
  readonly anonymous: () => unknown;
  /** Calls the function as B and asserts it saw or changed only B's data. */
  readonly asB: (input: unknown) => Promise<void>;
}

/** Calls `fn` as B: answered with `expected`, no cookie set, the instance, admins, invitations, and mail unchanged. */
export async function refused(fn: Name, input: unknown, expected: unknown = FORBIDDEN): Promise<void> {
  const state = async () => ({
    instance: await instanceRow(),
    admins: await count('users', `role = 'admin'`),
    invitations: await count('invitations'),
    mail: mail.length,
  });
  const before = await state();
  expect(await as('B', fn, input)).toEqual(expected);
  expect(browsers.B.lastSetCookies).toEqual([]);
  expect(await state()).toEqual(before);
}
