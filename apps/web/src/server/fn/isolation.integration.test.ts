// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tenant isolation at the API (M0 exit criterion, PRD §9.2): every web server function, called with the real
 * services (`createServices`) against PostgreSQL 18.6 and Valkey 9.2 and with real Better Auth sessions, as user B
 * sees and changes only B's data, refuses admin and setup actions, and never answers with an `_enc` field or a
 * secret. Admin A is created through the setup wizard (first admin, TOTP, instance settings with an SMTP password)
 * and invites B, who signs up with the invitation. A completeness guard fails for any server function without a
 * case in {@link MATRIX}, so new server functions cannot skip this test.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { ValkeyContainer, type StartedValkeyContainer } from '@testcontainers/valkey';
import { loadConfig } from '@wf/config';
import { createKeyFile, loadKeyring } from '@wf/crypto/keyring';
import type { AccountsOverview } from '@wf/db/accounts';
import type { BudgetHistoryEntry, BudgetStatus, BudgetVersionView } from '@wf/db/budgets';
import type { CategoryView } from '@wf/db/categories';
import type { Dashboard } from '@wf/db/dashboard';
import type { DraftView } from '@wf/db/drafts';
import { createDb, withUser, type Database } from '@wf/db/db';
import type { ManualRateInput } from '@wf/db/fx-rates';
import type { RecordResult } from '@wf/db/ledger-core';
import { migrate } from '@wf/db/migrate';
import {
  insertNotificationIn,
  type NextReminder,
  type NotificationCounts,
  type NotificationView,
} from '@wf/db/notifications';
import { createOccurrenceJobs } from '@wf/db/occurrence-jobs';
import type { ConfirmResult, ReviewCounts, ReviewItemView } from '@wf/db/review';
import { bootstrapRoles, ROLES, type RoleName } from '@wf/db/roles';
import type { Payday, PeriodsOverview, StartDayPreview } from '@wf/db/periods';
import type {
  ChangeAccountResult,
  DetectedOverview,
  RecurrenceView,
  ScheduledItem,
  SubscriptionsOverview,
  SubscriptionView,
} from '@wf/db/schedules';
import type { TagView } from '@wf/db/tags';
import type { CategoryGroup } from '@wf/db/transaction-query';
import type { TransactionDetail } from '@wf/db/transactions';
import { createUserKeys } from '@wf/db/user-keys';
import type { LimitDelta } from '@wf/domain/budget';
import { addDays } from '@wf/domain/period';
import { pino } from 'pino';
import postgres from 'postgres';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requestContext } from '../../../test/server-fn.ts';
import { SessionBrowser } from '../../../test/session-browser.ts';
import { SEARCH_KINDS, type RecentEntry, type SearchResults } from '../../lib/search.ts';
import type { Result } from '../access.ts';
import type { DeviceView, SecurityHistory, SecurityOverview } from '../account.ts';
import { getPreferences } from '../get-preferences.ts';
import type * as RuntimeModule from '../runtime.ts';
import { createServices, type Services } from '../runtime.ts';
import * as account from './account.ts';
import type { AccountDetail } from './accounts.ts';
import * as accounts from './accounts.ts';
import * as admin from './admin.ts';
import * as budgetWrite from './budget-write.ts';
import * as budget from './budget.ts';
import type { BudgetCategoryDetail } from './budget.ts';
import * as categories from './categories.ts';
import * as gate from './gate.ts';
import * as ledger from './ledger.ts';
import * as notifications from './notifications.ts';
// Named: the module also exports constants, which are not server functions.
import {
  finishOnboarding,
  getOnboarding,
  saveOnboardingAccounts,
  saveOnboardingGoal,
  saveOnboardingPeriod,
  saveOnboardingProfile,
  skipOnboardingGoal,
  type OnboardingView,
} from './onboarding.ts';
import * as review from './review.ts';
import * as schedules from './schedules.ts';
import * as search from './search.ts';
import * as setup from './setup.ts';
import * as tags from './tags.ts';
// Named: the module also exports its input schema, which is not a server function.
import {
  listDrafts,
  listTransactionDays,
  recordTransaction,
  removeDraft,
  removeTransactions,
  restoreTransactions,
  saveDraft,
} from './transactions-write.ts';
// Named: the module also exports constants, which are not server functions.
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
  type TransactionRowsPage,
  type TransactionsView,
} from './transactions.ts';

/** `YYYY-MM-DD` as the repositories' branded date type. */
type LocalDate = ManualRateInput['asOf'];

const running = vi.hoisted(() => ({ services: null as Promise<Services> | null }));

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
// The server functions get the services this test built with the real `createServices`.
vi.mock('../runtime.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeModule>()),
  services: () => running.services ?? Promise.reject(new Error('services not started')),
}));

/** Built at runtime so no fixture looks like a committed secret. */
const secret = (label: string) => `${label}-${randomBytes(12).toString('hex')}`;
const ROLE_PASSWORDS = {
  app: secret('app'),
  worker: secret('worker'),
  migrate: secret('migrate'),
  auth: secret('auth'),
  readonlyOps: null,
};
const ORIGIN = 'http://localhost:3000';
const AUTH_SECRET = secret('auth-secret');
const SETUP_TOKEN = secret('setup-token');
const SMTP_PASSWORD = secret('smtp');
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';

const A = { name: 'Avtara K.', email: 'avtara@example.test', password: secret('password-a') };
const B = { name: 'Budi Santoso', email: 'budi@example.test', password: secret('password-b') };
const INSTANCE_NAME = 'Keuangan Keluarga';

const SRC = fileURLToPath(new URL('../../', import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'wf-web-isolation-'));
const KEK_FILE = path.join(tmp, 'kek');

let pg: StartedPostgreSqlContainer;
let valkey: StartedValkeyContainer;
let superuser: postgres.Sql;
/** `wf_worker`, for the rows only the worker writes (notifications, due occurrences, review items). */
let workerDb: Database;
/** `wf_app`, for the users' DEKs the worker's occurrences job needs. */
let appDb: Database;
let services: Services;
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

/** The server functions this test imports; {@link MATRIX} must have a case for each. */
const FUNCTIONS = {
  ...account,
  ...accounts,
  ...admin,
  ...budget,
  ...budgetWrite,
  ...categories,
  ...gate,
  ...ledger,
  ...notifications,
  ...review,
  ...schedules,
  ...search,
  ...setup,
  ...tags,
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
type Name = keyof typeof FUNCTIONS;

type Caller = 'A' | 'B' | 'anonymous';
const browsers = {} as Record<Caller, SessionBrowser>;
let a2: SessionBrowser;
let b2: SessionBrowser;
let aId: string;
let bId: string;
let aAccountId: string;
let bAccountId: string;
/** A's expense (on {@link A_DAY}) and draft, which B must neither see nor change. */
let aTransactionId: string;
let aDraftId: string;
/** B's own transaction and draft, made by the `recordTransaction` and `saveDraft` cases. */
let bTransactionId: string;
let bDraftId: string;
/** The idempotency key of A's expense; B reusing it must still record B's own transaction. */
const A_CLIENT_ID = randomUUID();
const A_DAY = '2026-10-05';
const B_DAY = '2026-10-07';
/** Plaintext secrets no response may contain (stored ciphertexts and hashes are added in the final scan). */
const secrets: string[] = [AUTH_SECRET, SETUP_TOKEN, SMTP_PASSWORD, A.password, B.password];
/** Every server function response, for the final scan. */
const responses: { caller: Caller; fn: Name; value: unknown }[] = [];

/** Calls the server function `fn` as `caller` and records the response. */
async function as<T>(caller: Caller, fn: Name, data?: unknown): Promise<T> {
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

const sessionIds = async (userId: string) =>
  (await superuser<{ id: string }[]>`SELECT id FROM sessions WHERE user_id = ${userId} ORDER BY id`).map((r) => r.id);
const eventIds = async (userId: string) =>
  (await superuser<{ id: string }[]>`SELECT id FROM security_events WHERE user_id = ${userId} ORDER BY id DESC`).map(
    (r) => r.id,
  );
const profileRow = async (userId: string) =>
  (await superuser`SELECT name, nickname, locale, timezone FROM users WHERE id = ${userId}`)[0];
const instanceRow = async () => (await superuser`SELECT * FROM instance_settings`)[0];
const count = async (table: string, where = 'true') =>
  Number((await superuser.unsafe<{ n: string }[]>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`))[0]?.n);
const currentSessionId = async (browser: SessionBrowser) => (await browser.session())?.session.id;
/** Ids of a user's rows in the ledger and M3 tables the read functions return. */
const ledgerIds = async (userId: string) =>
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
      UNION ALL SELECT id::text FROM detected_recurring WHERE user_id = ${userId}
      ORDER BY 1`
  ).map((row) => row.id);
/** A user's notifications as stored, oldest first. */
const notificationRows = (userId: string) =>
  superuser<{ id: string; ref: string; read_at: Date | null }[]>`
    SELECT id::text, ref, read_at FROM notifications WHERE user_id = ${userId} ORDER BY id`;
/** Ids of a user's rows in `table` matching `where`, oldest first (ids are UUIDv7). */
const idsOf = async (table: string, userId: string, where = 'true') =>
  (
    await superuser.unsafe<{ id: string }[]>(
      `SELECT id::text FROM ${table} WHERE user_id = $1 AND ${where} ORDER BY id`,
      [userId],
    )
  ).map((row) => row.id);
/** A's schedules, review items, candidates, and notifications as stored; B's M3 calls must leave them unchanged. */
const aM3Rows = async () => ({
  subscriptions: await superuser`SELECT * FROM subscriptions WHERE user_id = ${aId} ORDER BY id`,
  recurrences: await superuser`SELECT * FROM recurrences WHERE user_id = ${aId} ORDER BY id`,
  occurrences: await superuser`SELECT * FROM scheduled_occurrences WHERE user_id = ${aId} ORDER BY id`,
  reviewItems: await superuser`SELECT * FROM review_items WHERE user_id = ${aId} ORDER BY id`,
  detected: await superuser`SELECT * FROM detected_recurring WHERE user_id = ${aId} ORDER BY id`,
  notifications: await superuser`SELECT * FROM notifications WHERE user_id = ${aId} ORDER BY id`,
});
/** The first id of A's rows in `table` (they exist from the setup). */
const firstOfA = async (table: string) => (await idsOf(table, aId))[0] ?? '';
/** JSON for the leak scan; ledger amounts are bigints. */
const toJson = (value: unknown) =>
  JSON.stringify(value, (_key, child: unknown) => (typeof child === 'bigint' ? child.toString() : child));
/** A's ledger and M3 rows, all with names B must never see. */
const A_LEDGER = {
  account: 'Rekening Rahasia A',
  category: 'Rahasia A',
  tag: 'rahasia-a',
  transaction: 'Belanja Rahasia A',
  note: 'Catatan Rahasia A',
  draft: 'Draf Rahasia A',
  subscription: 'Langganan Rahasia A',
  recurrence: 'Kos Rahasia A',
  detected: 'Toko Rahasia A',
};
/** Whether transaction `id` is soft-deleted. */
const isDeleted = async (id: string) =>
  (
    await superuser<{ deleted: boolean }[]>`SELECT deleted_at IS NOT NULL AS deleted FROM transactions WHERE id = ${id}`
  )[0]?.deleted;
/** The stored (encrypted) payload of draft `id`, or `undefined` when it is gone. */
const draftPayload = async (id: string) =>
  (await superuser<{ payload: string }[]>`SELECT encode(payload_enc, 'hex') AS payload FROM drafts WHERE id = ${id}`)[0]
    ?.payload;
/** The id of a user's live category or tag by its stored name or slug. */
const categoryId = async (userId: string, name: string) =>
  (
    await superuser<{ id: string }[]>`
      SELECT id::text FROM categories WHERE user_id = ${userId} AND name = ${name} AND deleted_at IS NULL`
  )[0]?.id ?? '';
const tagId = async (userId: string, slug: string) =>
  (await superuser<{ id: string }[]>`SELECT id::text FROM tags WHERE user_id = ${userId} AND slug = ${slug}`)[0]?.id ??
  '';
/** A's categories, tags, and aliases as stored; B's category and tag writes must leave them unchanged. */
const aLedgerRows = async () => ({
  categories: await superuser`SELECT * FROM categories WHERE user_id = ${aId} ORDER BY id`,
  tags: await superuser`SELECT * FROM tags WHERE user_id = ${aId} ORDER BY id`,
  aliases: await superuser`SELECT * FROM tag_aliases WHERE user_id = ${aId} ORDER BY id`,
  tagged: await superuser`SELECT tt.* FROM transaction_tags tt JOIN tags t ON t.id = tt.tag_id
    WHERE t.user_id = ${aId} ORDER BY 1, 2`,
});
/** A user's current period. */
const currentPeriod = async (userId: string) => (await services.periods.list(userId)).current;
/** The category of the budget line each user gets in `beforeAll`. */
const budgetedId = (userId: string) => categoryId(userId, `Anggaran ${userId === aId ? A_LEDGER.tag : 'tag-b'}`);
/** A second expense category for budget writes, so the line of {@link budgetedId} stays the only one between cases. */
const spareId = async (userId: string) =>
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
const onboardingRows = async (userId: string) => ({
  user: (
    await superuser`
      SELECT onboarding_step, onboarding_completed_at, base_currency, name, nickname FROM users WHERE id = ${userId}`
  )[0],
  extras: await superuser`SELECT extra_currencies FROM user_preferences WHERE user_id = ${userId}`,
  goals: await superuser`SELECT * FROM goals WHERE user_id = ${userId} ORDER BY id`,
  recurrences: await superuser`SELECT * FROM recurrences WHERE user_id = ${userId} ORDER BY id`,
  budgets: await superuser`SELECT * FROM budget_versions WHERE user_id = ${userId} ORDER BY id`,
});
const aBudgetRows = async () => ({
  versions: await superuser`SELECT * FROM budget_versions WHERE user_id = ${aId} ORDER BY id`,
  lines: await superuser`SELECT * FROM budget_lines WHERE user_id = ${aId} ORDER BY version_id, category_id`,
  overrides: await superuser`SELECT * FROM budget_period_overrides WHERE user_id = ${aId} ORDER BY id`,
  dismissals: await superuser`SELECT * FROM budget_alert_dismissals WHERE user_id = ${aId} ORDER BY 1, 2, 3`,
  periods: await superuser`SELECT * FROM periods WHERE user_id = ${aId} ORDER BY start_date`,
  preferences: await superuser`SELECT period_start_day, period_mode FROM user_preferences WHERE user_id = ${aId}`,
});
/** Any id: the signed-out request is refused before it is looked up. */
const SOME_ID = '0192a6c4-0000-7000-8000-000000000000';
/** The id of a user's subscription by name, or `''`. */
const subscriptionOf = async (userId: string, name: string) =>
  (await idsOf('subscriptions', userId, `name = '${name}'`))[0] ?? '';
/** B's weekly "Arisan B" recurrence paid from `accountId`. */
const arisan = (accountId: string, amountMinor = 50_000n) => ({
  template: { type: 'expense', accountId, amountMinor, categoryId: null, description: 'Arisan B' },
  freq: 'weekly',
  startOn: '2026-11-02',
  end: { type: 'never' },
  remindOffsetDays: null,
});
const arisanOfB = async () => (await idsOf('recurrences', bId, `template->>'description' = 'Arisan B'`))[0] ?? '';
/** B's "Spotify B" subscription paid from `accountId`, first billed (and started) on `nextBillingDate`. */
const spotify = (accountId: string, nextBillingDate: string) => ({
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
const OCTOBER = '2026-10-01..2026-10-31';
/** B's "Kopi B" as the record form submits it, with `overrides`. */
const bExpense = (overrides: object = {}) => ({
  type: 'expense',
  clientId: randomUUID(),
  occurredAt: new Date(`${B_DAY}T05:00:00Z`),
  accountId: bAccountId,
  amountMinor: 25_000n,
  categoryId: null,
  description: 'Kopi B',
  ...overrides,
});
const transactionRow = async (id: string) =>
  (await superuser`SELECT user_id, description FROM transactions WHERE id = ${id}`)[0];

const smtpInput = (password?: string) => ({
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
const hostileInstance = () => ({ ...instanceInput(), instanceName: 'Pwned', registrationMode: 'open', smtp: null });

const UNAUTHENTICATED = { ok: false, code: 'UNAUTHENTICATED' };
/** A's accounts with every field a write could change, and A's ledger row counts. */
const aLedger = async () => ({
  accounts: await superuser`SELECT * FROM accounts WHERE user_id = ${aId} ORDER BY id`,
  transactions: await count('transactions', `user_id = '${aId}'`),
  adjustments: await count('balance_adjustments', `user_id = '${aId}'`),
});
/** Calls `fn` as B with `input` (aimed at A's account): refused as not found, A's ledger unchanged. */
async function notFoundForB(fn: Name, input: unknown): Promise<void> {
  const before = await aLedger();
  expect(await as('B', fn, input)).toEqual(NOT_FOUND);
  expect(await aLedger()).toEqual(before);
}
const bAccountNames = async () =>
  (
    await superuser<{ name: string; status: string }[]>`
    SELECT display_name AS name, status::text FROM accounts WHERE user_id = ${bId} ORDER BY sort_order, id`
  ).map((row) => `${row.name}:${row.status}`);
const FORBIDDEN = { ok: false, code: 'FORBIDDEN' };
const ok = <T>(value: T) => ({ ok: true, value });
const NOT_FOUND = { ok: false, code: 'NOT_FOUND' };
const INVALID_CATEGORY = { ok: false, code: 'INVALID_CATEGORY' };

beforeAll(async () => {
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
});

afterAll(async () => {
  smtp.close();
  await Promise.all([workerDb.$client.end(), appDb.$client.end()]);
  await superuser.end();
  await Promise.all([pg.stop(), valkey.stop()]);
  rmSync(tmp, { recursive: true, force: true });
});

/** Secrets as stored: TOTP secrets, backup codes, password hashes, session tokens, and encrypted or wrapped keys. */
async function storedSecrets(): Promise<string[]> {
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
async function aSnapshot() {
  return {
    profile: await profileRow(aId),
    sessions: await sessionIds(aId),
    events: await eventIds(aId),
    signedIn: [await currentSessionId(browsers.A), await currentSessionId(a2)],
  };
}

/** The ids of A's rows; none may appear in a response to B or a signed-out visitor. */
async function aIdentifiers(): Promise<string[]> {
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

interface Case {
  /** The input, the same for B and the signed-out visitor. */
  readonly input?: () => unknown;
  /** The exact answer to a signed-out request. */
  readonly anonymous: () => unknown;
  /** Calls the function as B and asserts it saw or changed only B's data. */
  readonly asB: (input: unknown) => Promise<void>;
}

/** Calls `fn` as B: answered with `expected`, no cookie set, the instance, admins, invitations, and mail unchanged. */
async function refused(fn: Name, input: unknown, expected: unknown = FORBIDDEN): Promise<void> {
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

/**
 * One case per server function; the type and the guard below make a missing case fail. Cases run in this order, so
 * later ones see B's profile as `updateProfile` and `saveLocale` left it.
 */
const MATRIX: Record<Name, Case> = {
  getProfile: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      expect(await as('B', 'getProfile')).toEqual(
        ok({ name: B.name, nickname: null, locale: 'en', timezone: 'Asia/Makassar' }),
      );
      expect(await as('A', 'getProfile')).toEqual(ok(await profileRow(aId)));
    },
  },
  updateProfile: {
    input: () => ({ name: 'Budi S.', nickname: 'Budi', locale: 'id', timezone: 'Asia/Jakarta' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await aSnapshot();
      expect(await as('B', 'updateProfile', input)).toEqual(ok(input));
      expect(await profileRow(bId)).toEqual(input);
      expect(await aSnapshot()).toEqual(a);
    },
  },
  saveLocale: {
    input: () => ({ locale: 'en' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await aSnapshot();
      expect(await as('B', 'saveLocale', input)).toEqual(ok(null));
      expect(await profileRow(bId)).toEqual({
        name: 'Budi S.',
        nickname: 'Budi',
        locale: 'en',
        timezone: 'Asia/Jakarta',
      });
      expect(await aSnapshot()).toEqual(a);
    },
  },
  getSecurity: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const result = await as<Result<SecurityOverview>>('B', 'getSecurity');
      if (!result.ok) throw new Error(`getSecurity failed: ${result.code}`);
      const { devices, history, ...rest } = result.value;
      expect(rest).toEqual({ twoFactorEnabled: true, hasPassword: true, googleLinked: false, passkeys: [] });
      expect(devices.map((device) => device.id).sort()).toEqual(await sessionIds(bId));
      expect(devices.filter((device) => device.current).map((device) => device.id)).toEqual([
        await currentSessionId(browsers.B),
      ]);
      expect(history.events.map((event) => event.id)).toEqual(await eventIds(bId));
      expect(history.nextBefore).toBeNull();
      const ofA = await as<Result<SecurityOverview>>('A', 'getSecurity');
      expect(ofA.ok && ofA.value.history.events.map((event) => event.id)).toEqual(await eventIds(aId));
    },
  },
  getSecurityHistory: {
    input: () => ({ before: '0192a6c4-0000-7000-8000-000000000000' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const [newestOfA = ''] = await eventIds(aId);
      const olderOfB = (await eventIds(bId)).filter((id) => id < newestOfA);
      expect(olderOfB.length).toBeGreaterThan(0);
      const result = await as<Result<SecurityHistory>>('B', 'getSecurityHistory', { before: newestOfA });
      expect(result.ok && { ids: result.value.events.map((event) => event.id), next: result.value.nextBefore }).toEqual(
        { ids: olderOfB, next: null },
      );
    },
  },
  listDevices: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const result = await as<Result<DeviceView[]>>('B', 'listDevices');
      expect(result.ok && result.value.map((device) => device.id).sort()).toEqual(await sessionIds(bId));
      expect(result.ok && result.value.filter((device) => device.current).map((device) => device.id)).toEqual([
        await currentSessionId(browsers.B),
      ]);
    },
  },
  revokeDevice: {
    input: () => ({ id: '0192a6c4-0000-7000-8000-000000000000' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aSnapshot();
      const ofB = await sessionIds(bId);
      for (const id of a.sessions) {
        expect(await as('B', 'revokeDevice', { id })).toEqual({ ok: false, code: 'DEVICE_NOT_FOUND' });
      }
      expect(await aSnapshot()).toEqual(a);
      expect(a.signedIn.every((id) => typeof id === 'string')).toBe(true);
      expect(await sessionIds(bId)).toEqual(ofB);
    },
  },
  revokeOtherDevices: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aSnapshot();
      const current = await currentSessionId(browsers.B);
      const others = (await sessionIds(bId)).length - 1;
      expect(others).toBeGreaterThan(0);
      expect(await as('B', 'revokeOtherDevices')).toEqual(ok({ count: others }));
      expect(await sessionIds(bId)).toEqual([current]);
      expect(await b2.session()).toBeNull();
      expect(await aSnapshot()).toEqual(a);
    },
  },
  getInstance: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      await refused('getInstance', undefined);
      expect(await as('A', 'getInstance')).toEqual(
        ok({
          instanceName: INSTANCE_NAME,
          publicUrl: `${ORIGIN}/`,
          defaultLocale: 'en',
          defaultTimezone: 'Asia/Makassar',
          registrationMode: 'invite',
          smtp: { ...smtpInput(), hasPassword: true },
        }),
      );
    },
  },
  saveInstance: {
    input: hostileInstance,
    anonymous: () => UNAUTHENTICATED,
    asB: (input) => refused('saveInstance', input),
  },
  sendInstanceTestEmail: {
    input: () => smtpInput(),
    anonymous: () => UNAUTHENTICATED,
    asB: (input) => refused('sendInstanceTestEmail', input),
  },
  inviteUser: {
    input: () => ({ email: 'mallory@example.test' }),
    anonymous: () => UNAUTHENTICATED,
    asB: (input) => refused('inviteUser', input),
  },
  getSetup: {
    input: () => ({ token: SETUP_TOKEN }),
    anonymous: () => ({ status: 'closed' }),
    asB: (input) => refused('getSetup', input, { status: 'closed' }),
  },
  createSetupAdmin: {
    input: () => ({ name: 'Mallory', email: 'mallory@example.test', password: secret('password-m'), locale: 'en' }),
    anonymous: () => FORBIDDEN,
    asB: async (input) => {
      await refused('createSetupAdmin', input);
      expect(await count('users', `email = 'mallory@example.test'`)).toBe(0);
    },
  },
  sendSetupTestEmail: {
    input: () => smtpInput(),
    anonymous: () => FORBIDDEN,
    asB: (input) => refused('sendSetupTestEmail', input),
  },
  saveSetup: {
    input: hostileInstance,
    anonymous: () => FORBIDDEN,
    asB: (input) => refused('saveSetup', input),
  },
  getGate: {
    anonymous: () => ({
      setup: 'complete',
      viewer: null,
      instanceName: INSTANCE_NAME,
      registrationMode: 'invite',
      googleEnabled: false,
    }),
    asB: async () => {
      expect(await as('B', 'getGate')).toEqual({
        setup: 'complete',
        viewer: {
          id: bId,
          sessionId: await currentSessionId(browsers.B),
          name: 'Budi S.',
          email: B.email,
          image: null,
          locale: 'en',
          timezone: 'Asia/Jakarta',
          role: 'user',
          twoFactorEnabled: true,
          // FR-A4: B has not started the onboarding yet (the onboarding cases come last).
          onboardingStep: 'profile',
        },
        instanceName: INSTANCE_NAME,
        registrationMode: 'invite',
        googleEnabled: false,
      });
    },
  },
  listAccounts: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<AccountsOverview>>('B', 'listAccounts', input);
      expect(ofB.ok && ofB.value.accounts.map((a) => a.displayName)).toEqual(['Rekening B']);
      expect(ofB.ok && ofB.value.availableMinor).toBe(1_000_000n);
      const ofA = await as<Result<AccountsOverview>>('A', 'listAccounts', input);
      expect(ofA.ok && ofA.value.accounts.map((a) => a.displayName)).toEqual([A_LEDGER.account]);
    },
  },
  listCategories: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<CategoryView[]>>('B', 'listCategories', input);
      const ids = await ledgerIds(bId);
      expect(ofB.ok && ofB.value.length).toBeGreaterThan(1);
      expect(ofB.ok && ofB.value.filter((c) => !ids.includes(c.id))).toEqual([]);
      expect(ofB.ok && ofB.value.map((c) => c.name)).toContain('Kategori B');
    },
  },
  listTags: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<TagView[]>>('B', 'listTags', input);
      expect(ofB.ok && ofB.value.map((t) => t.slug)).toEqual(['tag-b']);
      const ofA = await as<Result<TagView[]>>('A', 'listTags', { query: 'rahasia' });
      expect(ofA.ok && ofA.value.map((t) => t.slug)).toEqual([A_LEDGER.tag]);
    },
  },
  getReferenceRate: {
    input: () => ({ base: 'USD', quote: 'IDR' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      // A's manual rate is A's alone; B has none and no built-in rate exists yet.
      expect(await as('B', 'getReferenceRate', input)).toEqual(ok(null));
      expect(await as('A', 'getReferenceRate', input)).toMatchObject(ok({ rate: '16474', manual: true }));
    },
  },
  searchEverything: {
    input: () => ({ query: 'rekening' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<SearchResults>>('B', 'searchEverything', input);
      expect(ofB.ok && ofB.value.accounts.hits.map((hit) => hit.displayName)).toEqual(['Rekening B']);
      const rahasia = await as<Result<SearchResults>>('B', 'searchEverything', { query: 'rahasia' });
      expect(rahasia.ok && SEARCH_KINDS.map((kind) => rahasia.value[kind].total)).toEqual([0, 0, 0, 0, 0]);
      // A's own: the transaction "Belanja Rahasia A", the account, "Langganan Rahasia A", "Rahasia A" and the
      // budgeted "Anggaran rahasia-a", and the tag.
      const ofA = await as<Result<SearchResults>>('A', 'searchEverything', { query: 'rahasia' });
      expect(ofA.ok && SEARCH_KINDS.map((kind) => ofA.value[kind].total)).toEqual([1, 0, 1, 1, 2, 1]);
    },
  },
  touchRecent: {
    // B remembers A's account id: stored for B alone, and never resolved for B (below).
    input: () => ({ kind: 'account', ref: aAccountId }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      expect(await as('B', 'touchRecent', input)).toEqual(ok(null));
      expect(await count('recent_items', `user_id = '${bId}'`)).toBe(1);
      expect(await count('recent_items', `user_id = '${aId}'`)).toBe(0);
    },
  },
  listRecent: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      expect(await as('B', 'touchRecent', { kind: 'account', ref: bAccountId })).toEqual(ok(null));
      const ofB = await as<Result<RecentEntry[]>>('B', 'listRecent', input);
      expect(ofB.ok && ofB.value.map((entry) => entry.kind !== 'page' && entry.hit.id)).toEqual([bAccountId]);
      expect(await as('A', 'listRecent', input)).toEqual(ok([]));
    },
  },
  createCategory: {
    input: () => ({ kind: 'expense', group: 'needs', name: 'Pendidikan B', icon: 'graduation-cap', color: '#14b8a6' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await aLedgerRows();
      const created = await as<Result<CategoryView>>('B', 'createCategory', input);
      expect(created.ok && created.value).toMatchObject({ name: 'Pendidikan B', group: 'needs', color: '#14b8a6' });
      expect(await categoryId(bId, 'Pendidikan B')).toBe(created.ok && created.value.id);
      expect(await aLedgerRows()).toEqual(a);
    },
  },
  updateCategory: {
    input: () => ({ id: SOME_ID, icon: 'gift' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aLedgerRows();
      expect(await as('B', 'updateCategory', { id: await categoryId(aId, A_LEDGER.category), icon: 'gift' })).toEqual(
        NOT_FOUND,
      );
      expect(
        await as('B', 'updateCategory', { id: await categoryId(bId, 'Kategori B'), icon: 'gift', isFixed: true }),
      ).toMatchObject(ok({ name: 'Kategori B', icon: 'gift', isFixed: true }));
      expect(await aLedgerRows()).toEqual(a);
    },
  },
  moveCategory: {
    input: () => ({ id: SOME_ID, group: 'needs' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aLedgerRows();
      expect(await as('B', 'moveCategory', { id: await categoryId(aId, A_LEDGER.category), group: 'needs' })).toEqual(
        NOT_FOUND,
      );
      expect(await as('B', 'moveCategory', { id: await categoryId(bId, 'Kategori B'), group: 'needs' })).toMatchObject(
        ok({ group: 'needs' }),
      );
      expect(await aLedgerRows()).toEqual(a);
    },
  },
  archiveCategory: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aLedgerRows();
      expect(await as('B', 'archiveCategory', { id: await categoryId(aId, A_LEDGER.category) })).toEqual(NOT_FOUND);
      const archived = await as<Result<CategoryView>>('B', 'archiveCategory', {
        id: await categoryId(bId, 'Kategori B'),
      });
      expect(archived.ok && archived.value.archivedAt).toBeInstanceOf(Date);
      expect(await aLedgerRows()).toEqual(a);
    },
  },
  unarchiveCategory: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aLedgerRows();
      expect(await as('B', 'unarchiveCategory', { id: await categoryId(aId, A_LEDGER.category) })).toEqual(NOT_FOUND);
      expect(await as('B', 'unarchiveCategory', { id: await categoryId(bId, 'Kategori B') })).toMatchObject(
        ok({ archivedAt: null }),
      );
      expect(await aLedgerRows()).toEqual(a);
    },
  },
  reorderCategories: {
    input: () => ({ ids: [SOME_ID] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aLedgerRows();
      const ofA = await categoryId(aId, A_LEDGER.category);
      const needsOfB = (
        await superuser<{ id: string }[]>`
          SELECT id::text FROM categories
          WHERE user_id = ${bId} AND "group" = 'needs' AND deleted_at IS NULL ORDER BY sort_order DESC`
      ).map((row) => row.id);
      expect(await as('B', 'reorderCategories', { ids: [ofA] })).toEqual(NOT_FOUND);
      expect(await as('B', 'reorderCategories', { ids: [...needsOfB, ofA] })).toEqual(NOT_FOUND);
      expect(await as('B', 'reorderCategories', { ids: needsOfB })).toEqual(ok(null));
      expect(
        (
          await superuser<{ id: string }[]>`
            SELECT id::text FROM categories
            WHERE user_id = ${bId} AND "group" = 'needs' AND deleted_at IS NULL ORDER BY sort_order`
        ).map((row) => row.id),
      ).toEqual(needsOfB);
      expect(await aLedgerRows()).toEqual(a);
    },
  },
  mergeCategories: {
    input: () => ({ sourceId: SOME_ID, targetId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aLedgerRows();
      const ofA = await categoryId(aId, A_LEDGER.category);
      const source = await categoryId(bId, 'Pendidikan B');
      const target = await categoryId(bId, 'Kategori B');
      expect(await as('B', 'mergeCategories', { sourceId: source, targetId: ofA })).toEqual(NOT_FOUND);
      expect(await as('B', 'mergeCategories', { sourceId: ofA, targetId: target })).toEqual(NOT_FOUND);
      expect(await as('B', 'mergeCategories', { sourceId: source, targetId: target })).toEqual(ok({ moved: 0 }));
      expect(await categoryId(bId, 'Pendidikan B')).toBe('');
      expect(await aLedgerRows()).toEqual(a);
    },
  },
  deleteCategory: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aLedgerRows();
      expect(await as('B', 'deleteCategory', { id: await categoryId(aId, A_LEDGER.category) })).toEqual(NOT_FOUND);
      expect(await as('B', 'deleteCategory', { id: await categoryId(bId, 'Kategori B') })).toEqual(
        ok({ uncategorized: 0, reviewItems: 0 }),
      );
      expect(await categoryId(bId, 'Kategori B')).toBe('');
      expect(await aLedgerRows()).toEqual(a);
    },
  },
  createTag: {
    input: () => ({ input: '#Kopi Susu' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await aLedgerRows();
      const created = await as<Result<TagView>>('B', 'createTag', input);
      expect(created.ok && created.value).toMatchObject({ slug: 'kopi-susu', usageCount: 0, aliases: [] });
      expect(await tagId(bId, 'kopi-susu')).toBe(created.ok && created.value.id);
      expect(await aLedgerRows()).toEqual(a);
    },
  },
  renameTag: {
    input: () => ({ id: SOME_ID, input: 'tag-b2' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aLedgerRows();
      expect(await as('B', 'renameTag', { id: await tagId(aId, A_LEDGER.tag), input: 'tag-b2' })).toEqual(NOT_FOUND);
      expect(await as('B', 'renameTag', { id: await tagId(bId, 'tag-b'), input: '#Tag B2' })).toMatchObject(
        ok({ slug: 'tag-b2' }),
      );
      expect(await aLedgerRows()).toEqual(a);
    },
  },
  listSimilarTags: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      // Each user gets a likely duplicate of their own; neither sees the other's pair.
      await services.tags.create(bId, 'kopi');
      await services.tags.create(aId, `${A_LEDGER.tag}b`);
      expect(await as('B', 'listSimilarTags', input)).toEqual(ok([{ a: 'kopi', b: 'kopi-susu' }]));
      expect(await as('A', 'listSimilarTags', input)).toEqual(ok([{ a: A_LEDGER.tag, b: `${A_LEDGER.tag}b` }]));
    },
  },
  mergeTags: {
    input: () => ({ sourceIds: [SOME_ID], targetId: '0192a6c4-0000-7000-8000-000000000001' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aLedgerRows();
      const ofA = await tagId(aId, A_LEDGER.tag);
      const kopi = await tagId(bId, 'kopi');
      const target = await tagId(bId, 'kopi-susu');
      expect(await as('B', 'mergeTags', { sourceIds: [kopi], targetId: ofA })).toEqual(NOT_FOUND);
      expect(await as('B', 'mergeTags', { sourceIds: [ofA], targetId: target })).toEqual(NOT_FOUND);
      expect(await as('B', 'mergeTags', { sourceIds: [kopi], targetId: target })).toEqual(
        ok({ id: target, slug: 'kopi-susu', usageCount: 0, aliases: ['kopi'] }),
      );
      expect(await aLedgerRows()).toEqual(a);
    },
  },
  deleteTag: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aLedgerRows();
      expect(await as('B', 'deleteTag', { id: await tagId(aId, A_LEDGER.tag) })).toEqual(NOT_FOUND);
      expect(await as('B', 'deleteTag', { id: await tagId(bId, 'kopi-susu') })).toEqual(ok(null));
      expect(await tagId(bId, 'kopi-susu')).toBe('');
      expect(await aLedgerRows()).toEqual(a);
    },
  },
  listPeriods: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const ofB = await as<Result<PeriodsOverview>>('B', 'listPeriods');
      const ids = await ledgerIds(bId);
      expect(ofB.ok && ofB.value.periods.length).toBeGreaterThan(0);
      expect(ofB.ok && ofB.value.periods.filter((period) => !ids.includes(period.id as string))).toEqual([]);
      expect(ofB.ok && ids).toContain(ofB.ok && ofB.value.current.id);
    },
  },
  getBudgetStatus: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<BudgetStatus>>('B', 'getBudgetStatus', input);
      expect(ofB.ok && ofB.value.lines.map((line) => line.name)).toEqual(['Anggaran tag-b']);
      expect(ofB.ok && ofB.value.totals.limitMinor).toBe(500_000n);
      const [aPeriod] = await superuser<{ id: string }[]>`SELECT id::text FROM periods WHERE user_id = ${aId} LIMIT 1`;
      expect(await as('B', 'getBudgetStatus', { periodId: aPeriod?.id })).toEqual(NOT_FOUND);
    },
  },
  getDashboard: {
    input: () => ({ scope: 'month' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<Dashboard>>('B', 'getDashboard', input);
      expect(ofB.ok && ofB.value.period?.id).toBe(
        (
          await superuser<{ id: string }[]>`
        SELECT id::text FROM periods WHERE user_id = ${bId} ORDER BY start_date DESC LIMIT 1`
        )[0]?.id,
      );
      expect(ofB.ok && ofB.value.budget?.lines.map((line) => line.limitMinor)).toEqual([500_000n]);
      const [aPeriod] = await superuser<{ id: string }[]>`SELECT id::text FROM periods WHERE user_id = ${aId} LIMIT 1`;
      expect(await as('B', 'getDashboard', { scope: 'month', periodId: aPeriod?.id })).toEqual(NOT_FOUND);
      expect(await as('B', 'getDashboard', { scope: 'year' })).toMatchObject(ok({ scope: 'year' }));
    },
  },
  recordTransaction: {
    input: () => ({
      type: 'expense',
      clientId: A_CLIENT_ID,
      occurredAt: new Date(`${B_DAY}T05:00:00Z`),
      accountId: bAccountId,
      amountMinor: 25_000n,
      categoryId: null,
      description: 'Kopi B',
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const before = await count('transactions');
      // A's account is not B's to record on.
      expect(
        await as('B', 'recordTransaction', { ...(input as object), clientId: randomUUID(), accountId: aAccountId }),
      ).toEqual({ ok: false, code: 'NOT_FOUND' });
      expect(await count('transactions')).toBe(before);
      // A's idempotency key does not replay A's transaction for B.
      const recorded = await as<Result<RecordResult>>('B', 'recordTransaction', input);
      if (!recorded.ok) throw new Error(`recordTransaction failed: ${recorded.code}`);
      expect(recorded.value).toMatchObject({ created: true });
      expect(recorded.value.id).not.toBe(aTransactionId);
      bTransactionId = recorded.value.id;
      const row = async (id: string) =>
        (await superuser`SELECT user_id, description FROM transactions WHERE id = ${id}`)[0];
      expect(await row(bTransactionId)).toEqual({ user_id: bId, description: 'Kopi B' });
      expect(await row(aTransactionId)).toEqual({ user_id: aId, description: A_LEDGER.transaction });
    },
  },
  removeTransactions: {
    input: () => ({ ids: [aTransactionId] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      expect(await as('B', 'removeTransactions', input)).toEqual(ok({ deleted: [] }));
      expect(await isDeleted(aTransactionId)).toBe(false);
      expect(await as('B', 'removeTransactions', { ids: [bTransactionId, aTransactionId] })).toEqual(
        ok({ deleted: [bTransactionId] }),
      );
      expect([await isDeleted(bTransactionId), await isDeleted(aTransactionId)]).toEqual([true, false]);
    },
  },
  restoreTransactions: {
    input: () => ({ ids: [aTransactionId] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      // A deletes the expense; B cannot bring it back, A can.
      expect(await as('A', 'removeTransactions', input)).toEqual(ok({ deleted: [aTransactionId] }));
      expect(await as('B', 'restoreTransactions', input)).toEqual(ok({ restored: [] }));
      expect(await isDeleted(aTransactionId)).toBe(true);
      expect(await as('B', 'restoreTransactions', { ids: [bTransactionId, aTransactionId] })).toEqual(
        ok({ restored: [bTransactionId] }),
      );
      expect([await isDeleted(bTransactionId), await isDeleted(aTransactionId)]).toEqual([false, true]);
      expect(await as('A', 'restoreTransactions', input)).toEqual(ok({ restored: [aTransactionId] }));
      expect(await isDeleted(aTransactionId)).toBe(false);
    },
  },
  listTransactionDays: {
    input: () => ({ from: '2026-10-01', to: '2026-10-31' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      expect(await as('B', 'listTransactionDays', input)).toEqual(ok([B_DAY]));
      expect(await as('A', 'listTransactionDays', input)).toEqual(ok([A_DAY]));
    },
  },
  saveDraft: {
    input: () => ({ kind: 'transaction', payload: { description: 'Draf B' } }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofA = await draftPayload(aDraftId);
      expect(await as('B', 'saveDraft', { ...(input as object), id: aDraftId })).toEqual({
        ok: false,
        code: 'NOT_FOUND',
      });
      expect(await draftPayload(aDraftId)).toBe(ofA);
      const saved = await as<Result<{ id: string }>>('B', 'saveDraft', input);
      if (!saved.ok) throw new Error(`saveDraft failed: ${saved.code}`);
      bDraftId = saved.value.id;
      expect((await superuser`SELECT user_id FROM drafts WHERE id = ${bDraftId}`)[0]).toEqual({ user_id: bId });
    },
  },
  listDrafts: {
    input: () => ({ kind: 'transaction' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<DraftView[]>>('B', 'listDrafts', input);
      expect(ofB.ok && ofB.value.map((draft) => ({ id: draft.id, payload: draft.payload }))).toEqual([
        { id: bDraftId, payload: { description: 'Draf B' } },
      ]);
      const ofA = await as<Result<DraftView[]>>('A', 'listDrafts', input);
      expect(ofA.ok && ofA.value.map((draft) => ({ id: draft.id, payload: draft.payload }))).toEqual([
        { id: aDraftId, payload: { description: A_LEDGER.draft } },
      ]);
    },
  },
  removeDraft: {
    input: () => ({ id: aDraftId }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofA = await draftPayload(aDraftId);
      expect(await as('B', 'removeDraft', input)).toEqual({ ok: false, code: 'NOT_FOUND' });
      expect(await draftPayload(aDraftId)).toBe(ofA);
      expect(await as('B', 'removeDraft', { id: bDraftId })).toEqual(ok(null));
      expect(await count('drafts', `user_id = '${bId}'`)).toBe(0);
    },
  },
  createAccount: {
    input: () => ({
      type: 'cash',
      providerName: 'Dompet B',
      displayName: 'Dompet B',
      currency: 'IDR',
      openingBalanceMinor: 50_000n,
      openingDate: '2026-10-01',
      color: 'green',
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const before = await aLedger();
      expect(await as('B', 'createAccount', input)).toMatchObject(ok({ displayName: 'Dompet B' }));
      expect(await bAccountNames()).toEqual(['Rekening B:active', 'Dompet B:active']);
      expect(await aLedger()).toEqual(before);
    },
  },
  updateAccount: {
    input: () => ({ id: aAccountId, patch: { displayName: 'Pwned', showAsCard: true } }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('updateAccount', input);
      expect(await as('B', 'updateAccount', { id: bAccountId, patch: { displayName: 'Rekening B' } })).toMatchObject(
        ok({ displayName: 'Rekening B' }),
      );
    },
  },
  getAccountDetail: {
    input: () => ({ id: aAccountId }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('getAccountDetail', input);
      const ofB = await as<Result<AccountDetail>>('B', 'getAccountDetail', { id: bAccountId });
      expect(
        ofB.ok && ofB.value.recent.every((row) => row.accountId === bAccountId || row.toAccountId === bAccountId),
      ).toBe(true);
    },
  },
  reconcileAccount: {
    input: () => ({ id: aAccountId, mode: 'correction', actualBalanceMinor: 1n }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('reconcileAccount', input);
    },
  },
  reconcileAccounts: {
    input: () => ({
      occurredAt: new Date('2026-10-15T05:00:00Z'),
      items: [
        { id: aAccountId, actualBalanceMinor: 1n, categoryId: null, clientId: '0192a6c4-0000-7000-8000-0000000000d1' },
      ],
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('reconcileAccounts', input);
    },
  },
  reorderAccounts: {
    input: () => ({ ids: [aAccountId] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('reorderAccounts', input);
    },
  },
  archiveAccount: {
    // B tries to move its balance into A's account.
    input: () => ({
      id: bAccountId,
      transfer: { toAccountId: aAccountId, clientId: '0192a6c4-0000-7000-8000-0000000000d2' },
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('archiveAccount', input);
      expect(await bAccountNames()).toEqual(['Rekening B:active', 'Dompet B:active']);
      await notFoundForB('archiveAccount', { id: aAccountId });
      const dompet = (
        await superuser<{ id: string }[]>`
        SELECT id::text FROM accounts WHERE user_id = ${bId} AND display_name = 'Dompet B'`
      )[0]?.id;
      expect(await as('B', 'archiveAccount', { id: dompet })).toMatchObject(ok({ status: 'archived' }));
    },
  },
  restoreAccount: {
    input: () => ({ id: aAccountId }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('restoreAccount', input);
    },
  },
  deleteAccount: {
    input: () => ({ id: aAccountId }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('deleteAccount', input);
      const dompet = (
        await superuser<{ id: string }[]>`
        SELECT id::text FROM accounts WHERE user_id = ${bId} AND display_name = 'Dompet B'`
      )[0]?.id;
      expect(await as('B', 'deleteAccount', { id: dompet })).toEqual(ok({ deletedTransactions: 0 }));
      expect(await bAccountNames()).toEqual(['Rekening B:active']);
    },
  },
  setAccountLogo: {
    input: () => {
      const form = new FormData();
      form.set('id', aAccountId);
      form.set('file', new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' }));
      return form;
    },
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      // Refused before the image is read or anything reaches storage.
      await notFoundForB('setAccountLogo', input);
    },
  },
  removeAccountLogo: {
    input: () => ({ id: aAccountId }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('removeAccountLogo', input);
    },
  },
  listNotifications: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      type Page = Result<{ items: NotificationView[]; nextCursor: string | null }>;
      const ofB = await as<Page>('B', 'listNotifications', input);
      expect(ofB.ok && ofB.value.items.map((item) => item.id).sort()).toEqual(
        (await notificationRows(bId)).map((row) => row.id),
      );
      expect(ofB.ok && ofB.value.items.map((item) => item.params)).toContainEqual({ account: 'Rekening B' });
      expect(await as('B', 'listNotifications', { search: 'Rahasia' })).toEqual(ok({ items: [], nextCursor: null }));
      const [ofA] = await notificationRows(aId);
      expect(await as('B', 'listNotifications', { before: ofA?.id })).toEqual(ok({ items: [], nextCursor: null }));
      const forA = await as<Page>('A', 'listNotifications', { search: 'Rahasia' });
      expect(forA.ok && forA.value.items.map((item) => item.params)).toContainEqual({ account: A_LEDGER.account });
    },
  },
  getNotificationCounts: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const rows = (await notificationRows(bId)).length;
      expect(rows).toBeGreaterThan(1);
      const ofB = await as<Result<NotificationCounts>>('B', 'getNotificationCounts', input);
      expect(ofB.ok && ofB.value).toMatchObject({ total: rows, unread: rows });
    },
  },
  markNotificationsRead: {
    input: () => ({ all: true }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await aM3Rows();
      const ofA = (await notificationRows(aId)).map((row) => row.id);
      expect(await as('B', 'markNotificationsRead', { ids: ofA })).toEqual(ok({ updated: 0 }));
      const ofB = await notificationRows(bId);
      expect(await as('B', 'markNotificationsRead', input)).toEqual(ok({ updated: ofB.length }));
      expect((await notificationRows(bId)).every((row) => row.read_at instanceof Date)).toBe(true);
      expect(await aM3Rows()).toEqual(a);
      expect(a.notifications.every((row) => row.read_at === null)).toBe(true);
    },
  },
  getNextReminder: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const ofB = await as<Result<NextReminder | null>>('B', 'getNextReminder');
      const sourcesOfB = [...(await idsOf('subscriptions', bId)), ...(await idsOf('recurrences', bId))];
      expect(ofB.ok && sourcesOfB).toContain(ofB.ok && ofB.value?.sourceId);
      const ofA = await as<Result<NextReminder | null>>('A', 'getNextReminder');
      const sourcesOfA = [...(await idsOf('subscriptions', aId)), ...(await idsOf('recurrences', aId))];
      expect(ofA.ok && sourcesOfA).toContain(ofA.ok && ofA.value?.sourceId);
    },
  },
  listReviewItems: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      type Page = Result<{ items: ReviewItemView[]; total: number }>;
      const ofB = await as<Page>('B', 'listReviewItems', input);
      expect(ofB.ok && ofB.value.items.map((item) => item.id).sort()).toEqual(await idsOf('review_items', bId));
      expect(ofB.ok && ofB.value.items.map((item) => item.label).sort()).toEqual([
        'Kos B',
        'Langganan B',
        'Langganan B2',
      ]);
      expect(await as('B', 'listReviewItems', { status: 'resolved' })).toEqual(ok({ items: [], total: 0 }));
      const ofA = await as<Page>('A', 'listReviewItems', input);
      expect(ofA.ok && ofA.value.items.map((item) => item.label).sort()).toEqual([
        A_LEDGER.recurrence,
        A_LEDGER.subscription,
      ]);
    },
  },
  getReviewCounts: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      expect(await as<Result<ReviewCounts>>('B', 'getReviewCounts')).toMatchObject(
        ok({ total: 3, byReason: { due_occurrence: 3 } }),
      );
      expect(await as<Result<ReviewCounts>>('A', 'getReviewCounts')).toMatchObject(ok({ total: 2 }));
    },
  },
  markReviewUnpaid: {
    input: () => ({ itemId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      expect(await as('B', 'markReviewUnpaid', { itemId: await firstOfA('review_items') })).toEqual(NOT_FOUND);
      const [itemId] = await idsOf('review_items', bId, `status = 'pending'`);
      expect(await as('B', 'markReviewUnpaid', { itemId })).toEqual(ok(null));
      expect(await idsOf('review_items', bId, `status = 'pending'`)).toContain(itemId);
      expect(await aM3Rows()).toEqual(a);
    },
  },
  confirmReview: {
    input: () => ({ itemId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      const occurredAt = new Date();
      expect(await as('B', 'confirmReview', { itemId: await firstOfA('review_items'), edits: { occurredAt } })).toEqual(
        NOT_FOUND,
      );
      const [itemId] = await idsOf('review_items', bId, `status = 'pending'`);
      const confirmed = await as<Result<ConfirmResult>>('B', 'confirmReview', { itemId, edits: { occurredAt } });
      expect(confirmed).toMatchObject(ok({ overrideIds: [] }));
      expect(await idsOf('transactions', bId)).toContain(confirmed.ok && confirmed.value.transactionId);
      expect(await as('B', 'confirmReview', { itemId })).toEqual({ ok: false, code: 'REVIEW_RESOLVED' });
      expect(await aM3Rows()).toEqual(a);
    },
  },
  confirmReviewBulk: {
    input: () => ({ itemIds: [SOME_ID] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      const ofA = await firstOfA('review_items');
      const [itemId] = await idsOf('review_items', bId, `status = 'pending'`);
      // Not recorded for the leak scan: the answer names A's id only because B sent it.
      expect(await browsers.B.call(FUNCTIONS.confirmReviewBulk, { itemIds: [ofA, itemId] })).toEqual(
        ok({ confirmed: [itemId], failed: [{ id: ofA, code: 'NOT_FOUND' }] }),
      );
      expect(await aM3Rows()).toEqual(a);
    },
  },
  ignoreReview: {
    input: () => ({ itemIds: [SOME_ID] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      expect(await as('B', 'ignoreReview', { itemIds: await idsOf('review_items', aId) })).toEqual(ok({ ignored: 0 }));
      const pending = await idsOf('review_items', bId, `status = 'pending'`);
      expect(pending).toHaveLength(1);
      expect(await as('B', 'ignoreReview', { itemIds: pending })).toEqual(ok({ ignored: 1 }));
      expect(await idsOf('review_items', bId, `status = 'ignored'`)).toEqual(pending);
      expect(await aM3Rows()).toEqual(a);
    },
  },
  confirmOccurrence: {
    input: () => ({ occurrenceId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      const edits = { occurredAt: new Date() };
      const [ofA] = await idsOf('scheduled_occurrences', aId, `status = 'scheduled'`);
      expect(await as('B', 'confirmOccurrence', { occurrenceId: ofA, edits })).toEqual(NOT_FOUND);
      const [occurrenceId] = await idsOf('scheduled_occurrences', bId, `status = 'scheduled'`);
      const confirmed = await as<Result<ConfirmResult>>('B', 'confirmOccurrence', { occurrenceId, edits });
      expect(await idsOf('transactions', bId)).toContain(confirmed.ok && confirmed.value.transactionId);
      expect(await idsOf('scheduled_occurrences', bId, `status = 'confirmed'`)).toContain(occurrenceId);
      expect(await aM3Rows()).toEqual(a);
    },
  },
  listRecurrences: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<RecurrenceView[]>>('B', 'listRecurrences', input);
      expect(ofB.ok && ofB.value.map((recurrence) => recurrence.id)).toEqual(await idsOf('recurrences', bId));
      expect(ofB.ok && ofB.value.map((recurrence) => recurrence.template.description)).toEqual(['Kos B']);
      const ofA = await as<Result<RecurrenceView[]>>('A', 'listRecurrences', input);
      expect(ofA.ok && ofA.value.map((recurrence) => recurrence.template.description)).toEqual([A_LEDGER.recurrence]);
    },
  },
  createRecurrence: {
    input: () => arisan(SOME_ID),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      expect(await as('B', 'createRecurrence', arisan(await firstOfA('accounts')))).toEqual({
        ok: false,
        code: 'INVALID_RECURRENCE',
      });
      const [accountOfB = ''] = await idsOf('accounts', bId);
      const created = await as<Result<RecurrenceView>>('B', 'createRecurrence', arisan(accountOfB));
      expect(created).toMatchObject(ok({ template: { description: 'Arisan B' }, freq: 'weekly', status: 'active' }));
      expect(await idsOf('recurrences', bId)).toContain(created.ok && created.value.id);
      // The first occurrence must be B's own transaction.
      expect(
        await as('B', 'createRecurrence', { ...arisan(accountOfB), transactionId: await firstOfA('transactions') }),
      ).toEqual(NOT_FOUND);
      expect(await aM3Rows()).toEqual(a);
    },
  },
  getTransactionRecurrence: {
    input: () => ({ transactionId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const [accountOfB = ''] = await idsOf('accounts', bId);
      const [transactionOfB = ''] = await idsOf('transactions', bId);
      const created = await as<Result<RecurrenceView>>('B', 'createRecurrence', {
        ...arisan(accountOfB),
        transactionId: transactionOfB,
      });
      expect(await as('B', 'getTransactionRecurrence', { transactionId: transactionOfB })).toMatchObject(
        ok({ id: created.ok && created.value.id }),
      );
      expect(await as('A', 'getTransactionRecurrence', { transactionId: transactionOfB })).toEqual(ok(null));
    },
  },
  updateRecurrence: {
    input: () => ({ id: SOME_ID, ...arisan(SOME_ID) }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      const [accountOfB = ''] = await idsOf('accounts', bId);
      const changed = arisan(accountOfB, 75_000n);
      expect(await as('B', 'updateRecurrence', { id: await firstOfA('recurrences'), ...changed })).toEqual(NOT_FOUND);
      expect(await as('B', 'updateRecurrence', { id: await arisanOfB(), ...changed })).toMatchObject(
        ok({ template: { amountMinor: 75_000n } }),
      );
      expect(await aM3Rows()).toEqual(a);
    },
  },
  stopRecurrence: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      expect(await as('B', 'stopRecurrence', { id: await firstOfA('recurrences') })).toEqual(NOT_FOUND);
      const stopped = await as<Result<{ deletedOccurrences: number }>>('B', 'stopRecurrence', {
        id: await arisanOfB(),
      });
      expect(stopped.ok && stopped.value.deletedOccurrences).toBeGreaterThan(0);
      expect(await aM3Rows()).toEqual(a);
    },
  },
  undoStopRecurrence: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      expect(await as('B', 'undoStopRecurrence', { id: await firstOfA('recurrences') })).toEqual(NOT_FOUND);
      expect(await as('B', 'undoStopRecurrence', { id: await arisanOfB() })).toMatchObject(ok({ status: 'active' }));
      expect(await aM3Rows()).toEqual(a);
    },
  },
  listSubscriptions: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<SubscriptionsOverview>>('B', 'listSubscriptions', input);
      expect(ofB.ok && ofB.value.subscriptions.map((subscription) => subscription.name).sort()).toEqual([
        'Langganan B',
        'Langganan B2',
      ]);
      const ofA = await as<Result<SubscriptionsOverview>>('A', 'listSubscriptions', input);
      expect(ofA.ok && ofA.value.subscriptions.map((subscription) => subscription.name)).toEqual([
        A_LEDGER.subscription,
      ]);
    },
  },
  countActiveSubscriptions: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const ofB = await as<Result<SubscriptionsOverview>>('B', 'listSubscriptions', {});
      expect(await as('B', 'countActiveSubscriptions', undefined)).toEqual(ok(ofB.ok ? ofB.value.counts.active : -1));
    },
  },
  setSubscriptionLogo: {
    input: () => {
      const form = new FormData();
      form.set('id', SOME_ID);
      form.set('file', new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' }));
      return form;
    },
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      // Refused before the image is read or anything reaches storage.
      const form = new FormData();
      form.set('id', await firstOfA('subscriptions'));
      form.set('file', new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' }));
      const a = await aM3Rows();
      expect(await as('B', 'setSubscriptionLogo', form)).toEqual(NOT_FOUND);
      expect(await aM3Rows()).toEqual(a);
    },
  },
  removeSubscriptionLogo: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      expect(await as('B', 'removeSubscriptionLogo', { id: await firstOfA('subscriptions') })).toEqual(NOT_FOUND);
      expect(await aM3Rows()).toEqual(a);
    },
  },
  getSubscription: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      expect(await as('B', 'getSubscription', { id: await firstOfA('subscriptions') })).toEqual(NOT_FOUND);
      expect(await as('B', 'getSubscription', { id: await subscriptionOf(bId, 'Langganan B') })).toMatchObject(
        ok({ name: 'Langganan B', priceMinor: 186_000n }),
      );
    },
  },
  createSubscription: {
    input: () => spotify(SOME_ID, '2026-11-05'),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      const later = addDays((await services.schedules.listSubscriptions(bId)).today, 20);
      expect(await as('B', 'createSubscription', spotify(await firstOfA('accounts'), later))).toEqual({
        ok: false,
        code: 'INVALID_SUBSCRIPTION',
      });
      const [accountOfB = ''] = await idsOf('accounts', bId);
      const created = await as<Result<SubscriptionView>>('B', 'createSubscription', spotify(accountOfB, later));
      expect(created).toMatchObject(ok({ name: 'Spotify B', nextBillingDate: later }));
      expect(await subscriptionOf(bId, 'Spotify B')).toBe(created.ok && created.value.id);
      expect(await aM3Rows()).toEqual(a);
    },
  },
  updateSubscription: {
    input: () => ({ id: SOME_ID, patch: { plan: 'Family' } }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      const patch = { plan: 'Family' };
      expect(await as('B', 'updateSubscription', { id: await firstOfA('subscriptions'), patch })).toEqual(NOT_FOUND);
      expect(await as('B', 'updateSubscription', { id: await subscriptionOf(bId, 'Spotify B'), patch })).toMatchObject(
        ok({ plan: 'Family' }),
      );
      expect(await aM3Rows()).toEqual(a);
    },
  },
  changeSubscriptionAccount: {
    input: () => ({ id: SOME_ID, accountId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      const [accountOfB = ''] = await idsOf('accounts', bId);
      const spotifyOfB = await subscriptionOf(bId, 'Spotify B');
      expect(
        await as('B', 'changeSubscriptionAccount', { id: await firstOfA('subscriptions'), accountId: accountOfB }),
      ).toEqual(NOT_FOUND);
      expect(
        await as('B', 'changeSubscriptionAccount', { id: spotifyOfB, accountId: await firstOfA('accounts') }),
      ).toEqual({ ok: false, code: 'INVALID_SUBSCRIPTION' });
      const changed = await as<Result<ChangeAccountResult>>('B', 'changeSubscriptionAccount', {
        id: spotifyOfB,
        accountId: accountOfB,
      });
      expect(changed.ok).toBe(true);
      expect(await aM3Rows()).toEqual(a);
    },
  },
  pauseSubscription: {
    input: () => ({ id: SOME_ID, length: { months: 1 }, remindDaysBefore: 3 }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      const pause = { length: { months: 1 }, remindDaysBefore: 3 };
      expect(await as('B', 'pauseSubscription', { ...pause, id: await firstOfA('subscriptions') })).toEqual(NOT_FOUND);
      const paused = await as<Result<SubscriptionView>>('B', 'pauseSubscription', {
        ...pause,
        id: await subscriptionOf(bId, 'Spotify B'),
      });
      expect(paused.ok && paused.value.pausedUntil).toEqual(expect.any(String));
      expect(await aM3Rows()).toEqual(a);
    },
  },
  reactivateSubscription: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      expect(await as('B', 'reactivateSubscription', { id: await firstOfA('subscriptions') })).toEqual(NOT_FOUND);
      expect(await as('B', 'reactivateSubscription', { id: await subscriptionOf(bId, 'Spotify B') })).toMatchObject(
        ok({ pausedUntil: null, effectiveStatus: 'active' }),
      );
      expect(await aM3Rows()).toEqual(a);
    },
  },
  cancelSubscription: {
    input: () => ({ id: SOME_ID, mode: 'after_next_bill' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      const mode = 'after_next_bill';
      expect(await as('B', 'cancelSubscription', { id: await firstOfA('subscriptions'), mode })).toEqual(NOT_FOUND);
      expect(await as('B', 'cancelSubscription', { id: await subscriptionOf(bId, 'Spotify B'), mode })).toMatchObject(
        ok({ cancelMode: mode }),
      );
      expect(await aM3Rows()).toEqual(a);
    },
  },
  rateSubscriptionUsage: {
    input: () => ({ id: SOME_ID, rating: 'rarely' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      const rating = 'rarely';
      expect(await as('B', 'rateSubscriptionUsage', { id: await firstOfA('subscriptions'), rating })).toEqual(
        NOT_FOUND,
      );
      expect(
        await as('B', 'rateSubscriptionUsage', { id: await subscriptionOf(bId, 'Langganan B'), rating }),
      ).toMatchObject(ok({ usageRating: rating }));
      expect(await aM3Rows()).toEqual(a);
    },
  },
  getSubscriptionBilling: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      expect(await as('B', 'getSubscriptionBilling', { id: await firstOfA('subscriptions') })).toEqual(NOT_FOUND);
      const id = await subscriptionOf(bId, 'Langganan B');
      const ofB = await as<Result<{ count: number; charges: { transactionId: string }[] }>>(
        'B',
        'getSubscriptionBilling',
        { id },
      );
      expect(ofB.ok && ofB.value.count).toBe(
        await count('scheduled_occurrences', `source_id = '${id}' AND status = 'confirmed'`),
      );
      const transactionsOfB = await idsOf('transactions', bId);
      expect(ofB.ok && ofB.value.charges.every((charge) => transactionsOfB.includes(charge.transactionId))).toBe(true);
    },
  },
  listDetectedSubscriptions: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const ofB = await as<Result<DetectedOverview>>('B', 'listDetectedSubscriptions');
      expect(ofB.ok && ofB.value.candidates.map((candidate) => candidate.merchant).sort()).toEqual([
        'Gym B',
        'Vidio B',
      ]);
      const ofA = await as<Result<DetectedOverview>>('A', 'listDetectedSubscriptions');
      expect(ofA.ok && ofA.value.candidates.map((candidate) => candidate.merchant)).toEqual([A_LEDGER.detected]);
    },
  },
  addDetectedSubscriptions: {
    input: () => ({ ids: [SOME_ID] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      const vidio = await idsOf('detected_recurring', bId, `merchant = 'Vidio B'`);
      expect(await as('B', 'addDetectedSubscriptions', { ids: [await firstOfA('detected_recurring')] })).toEqual(
        NOT_FOUND,
      );
      const added = await as<Result<{ subscriptionIds: string[] }>>('B', 'addDetectedSubscriptions', { ids: vidio });
      expect(added.ok && added.value.subscriptionIds).toHaveLength(1);
      expect(await idsOf('subscriptions', bId)).toEqual(
        expect.arrayContaining(added.ok ? added.value.subscriptionIds : ['']),
      );
      expect(await aM3Rows()).toEqual(a);
    },
  },
  dismissDetectedSubscriptions: {
    input: () => ({ ids: [SOME_ID] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      expect(await as('B', 'dismissDetectedSubscriptions', { ids: [await firstOfA('detected_recurring')] })).toEqual(
        ok({ dismissed: 0 }),
      );
      const gym = await idsOf('detected_recurring', bId, `merchant = 'Gym B'`);
      expect(await as('B', 'dismissDetectedSubscriptions', { ids: gym })).toEqual(ok({ dismissed: 1 }));
      expect(await aM3Rows()).toEqual(a);
    },
  },
  deleteSubscription: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      expect(await as('B', 'deleteSubscription', { id: await firstOfA('subscriptions') })).toEqual(NOT_FOUND);
      const deleted = await as<Result<{ deletedOccurrences: number }>>('B', 'deleteSubscription', {
        id: await subscriptionOf(bId, 'Spotify B'),
      });
      expect(deleted.ok && deleted.value.deletedOccurrences).toBeGreaterThanOrEqual(0);
      expect(await subscriptionOf(bId, 'Spotify B')).toBe('');
      expect(await aM3Rows()).toEqual(a);
    },
  },
  listScheduled: {
    input: () => ({ from: '2026-10-01', to: '2026-10-31' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const { today } = await services.schedules.listSubscriptions(bId);
      const range = { from: today, to: addDays(today, 60) };
      const ofB = await as<Result<ScheduledItem[]>>('B', 'listScheduled', range);
      const sourcesOfB = [...(await idsOf('subscriptions', bId)), ...(await idsOf('recurrences', bId))];
      expect(ofB.ok && ofB.value.length).toBeGreaterThan(0);
      expect(ofB.ok && ofB.value.filter((item) => !sourcesOfB.includes(item.sourceId))).toEqual([]);
      expect(await as('B', 'listScheduled', { from: today, to: addDays(today, 400) })).toEqual({
        ok: false,
        code: 'INVALID_PERIOD',
      });
    },
  },
  getBudgetHistory: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const ofB = await as<Result<BudgetHistoryEntry[]>>('B', 'getBudgetHistory');
      expect(ofB).toMatchObject(ok([{ totalMinor: 500_000n, lineCount: 1, changes: null }]));
      expect(await ledgerIds(bId)).toContain(ofB.ok && ofB.value[0]?.versionId);
    },
  },
  getBudgetFill: {
    input: () => ({ periodId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      // B has no spending before the current period, so nothing to suggest.
      expect(await as('B', 'getBudgetFill', { periodId: (await currentPeriod(bId)).id })).toEqual(ok([]));
      expect(await as('B', 'getBudgetFill', { periodId: (await currentPeriod(aId)).id })).toEqual(NOT_FOUND);
    },
  },
  listPeriodSpending: {
    input: () => ({ periodId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const ofB = await as<Result<CategoryGroup[]>>('B', 'listPeriodSpending', {
        periodId: (await currentPeriod(bId)).id,
      });
      const ids = await ledgerIds(bId);
      expect(ofB.ok && ofB.value.filter((group) => group.kind !== 'expense')).toEqual([]);
      expect(
        ofB.ok && ofB.value.filter((group) => group.categoryId !== null && !ids.includes(group.categoryId)),
      ).toEqual([]);
      expect(await as('B', 'listPeriodSpending', { periodId: (await currentPeriod(aId)).id })).toEqual(NOT_FOUND);
    },
  },
  getBudgetCategory: {
    input: () => ({ periodId: SOME_ID, categoryId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const period = await currentPeriod(bId);
      const ofB = await as<Result<BudgetCategoryDetail>>('B', 'getBudgetCategory', {
        periodId: period.id,
        categoryId: await budgetedId(bId),
      });
      expect(ofB).toMatchObject(
        ok({ months: [{ label: period.label, spentMinor: 0n, current: true }], transactions: [], transactionCount: 0 }),
      );
      expect(ofB.ok && ofB.value.daily.length).toBe(period.days);
      expect(
        await as('B', 'getBudgetCategory', {
          periodId: (await currentPeriod(aId)).id,
          categoryId: await budgetedId(bId),
        }),
      ).toEqual(NOT_FOUND);
      // A's category filters B's own transactions down to none.
      expect(
        await as('B', 'getBudgetCategory', { periodId: period.id, categoryId: await budgetedId(aId) }),
      ).toMatchObject(ok({ transactions: [], transactionCount: 0 }));
    },
  },
  getPeriodSettings: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const ofB = await as<Result<{ overview: PeriodsOverview; payday: Payday }>>('B', 'getPeriodSettings');
      const ids = await ledgerIds(bId);
      expect(ofB.ok && ofB.value.overview.periods.filter((period) => !ids.includes(period.id as string))).toEqual([]);
      expect(ofB.ok && ids).toContain(ofB.ok && ofB.value.overview.current.id);
      expect(ofB.ok && ofB.value.payday).toEqual({ day: null, merchant: null, count: 0 });
    },
  },
  saveBudgetVersion: {
    input: () => ({ effectiveFrom: '2026-10', lines: [] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aBudgetRows();
      const { label } = await currentPeriod(bId);
      const own = { categoryId: await budgetedId(bId), limitMinor: 500_000n };
      const foreign = { categoryId: await budgetedId(aId), limitMinor: 1n };
      expect(await as('B', 'saveBudgetVersion', { effectiveFrom: label, lines: [own, foreign] })).toEqual(
        INVALID_CATEGORY,
      );
      const spare = { categoryId: await spareId(bId), limitMinor: 200_000n, rollover: true, alertPct: 80 };
      const saved = await as<Result<BudgetVersionView>>('B', 'saveBudgetVersion', {
        effectiveFrom: label,
        lines: [own, spare],
      });
      expect(saved).toMatchObject(ok({ effectiveFrom: label, totalMinor: 700_000n }));
      expect(await ledgerIds(bId)).toContain(saved.ok && saved.value.id);
      // Back to the single line of `beforeAll`.
      expect(await as('B', 'saveBudgetVersion', { effectiveFrom: label, lines: [own] })).toMatchObject(
        ok({ totalMinor: 500_000n }),
      );
      expect(await aBudgetRows()).toEqual(a);
    },
  },
  setBudgetLine: {
    input: () => ({ periodId: SOME_ID, categoryId: SOME_ID, limitMinor: 1n }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aBudgetRows();
      const periodId = (await currentPeriod(bId)).id as string;
      const spare = await spareId(bId);
      expect(
        await as('B', 'setBudgetLine', { periodId: (await currentPeriod(aId)).id, categoryId: spare, limitMinor: 1n }),
      ).toEqual(NOT_FOUND);
      expect(await as('B', 'setBudgetLine', { periodId, categoryId: await budgetedId(aId), limitMinor: 1n })).toEqual(
        INVALID_CATEGORY,
      );
      expect(
        await as('B', 'setBudgetLine', { periodId, categoryId: spare, limitMinor: 300_000n, alertPct: 100 }),
      ).toMatchObject(ok({ totalMinor: 800_000n }));
      await services.budgets.removeLine(bId, periodId, spare);
      expect(await aBudgetRows()).toEqual(a);
    },
  },
  removeBudgetLine: {
    input: () => ({ periodId: SOME_ID, categoryId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aBudgetRows();
      const periodId = (await currentPeriod(bId)).id as string;
      const spare = await spareId(bId);
      await services.budgets.setLine(bId, periodId, { categoryId: spare, limitMinor: 100_000n });
      const aPeriod = (await currentPeriod(aId)).id;
      expect(await as('B', 'removeBudgetLine', { periodId: aPeriod, categoryId: await budgetedId(aId) })).toEqual(
        NOT_FOUND,
      );
      expect(await as('B', 'removeBudgetLine', { periodId, categoryId: await budgetedId(aId) })).toEqual(NOT_FOUND);
      expect(await as('B', 'removeBudgetLine', { periodId, categoryId: spare })).toMatchObject(
        ok({ totalMinor: 500_000n }),
      );
      expect(await aBudgetRows()).toEqual(a);
    },
  },
  moveBudgetLeftover: {
    input: () => ({
      periodId: SOME_ID,
      targetCategoryId: SOME_ID,
      sources: [{ categoryId: SOME_ID, amountMinor: 1n }],
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aBudgetRows();
      const periodId = (await currentPeriod(bId)).id as string;
      const spare = await spareId(bId);
      await services.budgets.setLine(bId, periodId, { categoryId: spare, limitMinor: 100_000n });
      const sources = [{ categoryId: await budgetedId(bId), amountMinor: 50_000n }];
      expect(
        await as('B', 'moveBudgetLeftover', {
          periodId: (await currentPeriod(aId)).id,
          targetCategoryId: spare,
          sources,
        }),
      ).toEqual(NOT_FOUND);
      expect(
        await as('B', 'moveBudgetLeftover', { periodId, targetCategoryId: await budgetedId(aId), sources }),
      ).toEqual({ ok: false, code: 'INVALID_BUDGET' });
      const moved = await as<Result<{ moveId: string; deltas: LimitDelta[] }>>('B', 'moveBudgetLeftover', {
        periodId,
        targetCategoryId: spare,
        sources,
      });
      expect(moved.ok && moved.value.deltas).toEqual(
        expect.arrayContaining([
          { categoryId: spare, deltaMinor: 50_000n },
          { categoryId: sources[0]?.categoryId, deltaMinor: -50_000n },
        ]),
      );
      await services.budgets.undoMove(bId, moved.ok ? moved.value.moveId : '');
      await services.budgets.removeLine(bId, periodId, spare);
      expect(await aBudgetRows()).toEqual(a);
    },
  },
  undoBudgetMove: {
    input: () => ({ moveId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      // A move of each user: from the budgeted line into the spare one.
      const moves = new Map<string, string>();
      for (const userId of [aId, bId]) {
        const periodId = (await currentPeriod(userId)).id as string;
        const spare = await spareId(userId);
        await services.budgets.setLine(userId, periodId, { categoryId: spare, limitMinor: 100_000n });
        const { moveId } = await services.budgets.moveLeftover(userId, periodId, {
          targetCategoryId: spare,
          sources: [{ categoryId: await budgetedId(userId), amountMinor: 10_000n }],
        });
        moves.set(userId, moveId);
      }
      const a = await aBudgetRows();
      expect(await as('B', 'undoBudgetMove', { moveId: moves.get(aId) })).toEqual(NOT_FOUND);
      expect(await aBudgetRows()).toEqual(a);
      expect(await as('B', 'undoBudgetMove', { moveId: moves.get(bId) })).toEqual(ok({ removed: 2 }));
      expect(await count('budget_period_overrides', `user_id = '${bId}'`)).toBe(0);
      await services.budgets.removeLine(bId, (await currentPeriod(bId)).id as string, await spareId(bId));
    },
  },
  dismissBudgetAlert: {
    input: () => ({ periodId: SOME_ID, categoryId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aBudgetRows();
      const periodId = (await currentPeriod(bId)).id as string;
      const categoryId = await budgetedId(bId);
      expect(await as('B', 'dismissBudgetAlert', { periodId: (await currentPeriod(aId)).id, categoryId })).toEqual(
        NOT_FOUND,
      );
      expect(await as('B', 'dismissBudgetAlert', { periodId, categoryId: await budgetedId(aId) })).toEqual(
        INVALID_CATEGORY,
      );
      expect(await as('B', 'dismissBudgetAlert', { periodId, categoryId })).toEqual(ok(null));
      const status = await services.budgets.status(bId, { periodId });
      expect(status.lines.map((line) => [line.categoryId, line.dismissed])).toEqual([[categoryId, true]]);
      await services.budgets.restoreAlert(bId, periodId, categoryId);
      expect(await aBudgetRows()).toEqual(a);
    },
  },
  restoreBudgetAlert: {
    input: () => ({ periodId: SOME_ID, categoryId: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const periodId = (await currentPeriod(bId)).id as string;
      const aPeriod = (await currentPeriod(aId)).id as string;
      const categoryId = await budgetedId(bId);
      await services.budgets.dismissAlert(bId, periodId, categoryId);
      await services.budgets.dismissAlert(aId, aPeriod, await budgetedId(aId));
      const a = await aBudgetRows();
      expect(a.dismissals).toHaveLength(1);
      expect(await as('B', 'restoreBudgetAlert', { periodId: aPeriod, categoryId: await budgetedId(aId) })).toEqual(
        NOT_FOUND,
      );
      // B's period with A's category: the delete reaches none of A's rows.
      expect(await as('B', 'restoreBudgetAlert', { periodId, categoryId: await budgetedId(aId) })).toEqual(ok(null));
      expect(await aBudgetRows()).toEqual(a);
      expect(await as('B', 'restoreBudgetAlert', { periodId, categoryId })).toEqual(ok(null));
      expect(await count('budget_alert_dismissals', `user_id = '${bId}'`)).toBe(0);
    },
  },
  previewPeriodStart: {
    input: () => ({ day: 25, apply: 'next_period' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await aBudgetRows();
      const ofB = await as<Result<StartDayPreview>>('B', 'previewPeriodStart', input);
      expect(ofB).toMatchObject(ok({ apply: 'next_period', fromDay: 1, toDay: 25 }));
      expect(ofB.ok && ofB.value.transition?.limitMinor).toBe(500_000n);
      expect(await services.periods.list(bId)).toMatchObject({ startDay: 1, mode: 'fixed_day' });
      expect(await aBudgetRows()).toEqual(a);
    },
  },
  // Last of the period cases: B's start day changes (and is set back).
  changePeriodStart: {
    input: () => ({ day: 25, apply: 'next_period' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await aBudgetRows();
      expect(await as('B', 'changePeriodStart', input)).toMatchObject(ok({ apply: 'next_period', toDay: 25 }));
      expect(await services.periods.list(bId)).toMatchObject({ startDay: 25 });
      expect(await aBudgetRows()).toEqual(a);
      await services.periods.changeStartDay(bId, { day: 1, apply: 'next_period' });
    },
  },
  getPreferences: {
    anonymous: () => requestContext(null).preferences,
    asB: async () => {
      expect(await as('B', 'getPreferences')).toEqual(requestContext(null).preferences);
    },
  },
  getTransactionsView: {
    input: () => ({ range: OCTOBER }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<TransactionsView>>('B', 'getTransactionsView', input);
      if (!ofB.ok) throw new Error(`getTransactionsView failed: ${ofB.code}`);
      expect(ofB.value.page.rows.map((row) => row.id)).toContain(bTransactionId);
      expect(ofB.value.page.rows.every((row) => row.accountId === bAccountId)).toBe(true);
      expect(ofB.value.accounts.map((group) => group.accountId)).toEqual([bAccountId]);
      expect(ofB.value).toMatchObject({ hasTransactions: true, unfilteredCount: ofB.value.page.total });
      // Filtering by A's account finds nothing, and no balance of it.
      expect(await as('B', 'getTransactionsView', { range: OCTOBER, account: aAccountId })).toMatchObject(
        ok({ page: { rows: [], total: 0, balances: {} }, accounts: [] }),
      );
      const ofA = await as<Result<TransactionsView>>('A', 'getTransactionsView', input);
      expect(ofA.ok && ofA.value.page.rows.map((row) => row.id)).toEqual([aTransactionId]);
    },
  },
  listTransactionRows: {
    input: () => ({ range: OCTOBER, account: bAccountId, offset: 0 }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<TransactionRowsPage>>('B', 'listTransactionRows', input);
      if (!ofB.ok) throw new Error(`listTransactionRows failed: ${ofB.code}`);
      expect(ofB.value.rows.map((row) => row.id)).toContain(bTransactionId);
      // Rekening B opened with Rp1.000.000 and B spent Rp25.000 on "Kopi B".
      expect(ofB.value.balances?.[bTransactionId]).toBe(975_000n);
      expect(await as('B', 'listTransactionRows', { range: OCTOBER, account: aAccountId, offset: 0 })).toEqual(
        ok({ rows: [], total: 0, balances: {} }),
      );
    },
  },
  getTransactionDetail: {
    input: () => ({ id: aTransactionId }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('getTransactionDetail', input);
      expect(await as('B', 'getTransactionDetail', { id: bTransactionId })).toMatchObject(
        ok({ id: bTransactionId, description: 'Kopi B' }),
      );
    },
  },
  updateTransaction: {
    input: () => ({ id: aTransactionId, input: bExpense({ description: 'Pwned' }) }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('updateTransaction', input);
      expect(await transactionRow(aTransactionId)).toEqual({ user_id: aId, description: A_LEDGER.transaction });
      // B cannot move its own expense onto A's account.
      await notFoundForB('updateTransaction', { id: bTransactionId, input: bExpense({ accountId: aAccountId }) });
      expect(await as('B', 'updateTransaction', { id: bTransactionId, input: bExpense() })).toMatchObject(
        ok({ id: bTransactionId, description: 'Kopi B' }),
      );
    },
  },
  duplicateTransaction: {
    input: () => ({ id: aTransactionId, input: bExpense({ clientId: randomUUID() }) }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('duplicateTransaction', input);
      const before = await count('transactions', `user_id = '${bId}'`);
      expect(
        await as('B', 'duplicateTransaction', { id: bTransactionId, input: bExpense({ clientId: randomUUID() }) }),
      ).toMatchObject(ok({ created: true }));
      expect(await count('transactions', `user_id = '${bId}' AND duplicated_from_id = '${bTransactionId}'`)).toBe(1);
      expect(await count('transactions', `user_id = '${bId}'`)).toBe(before + 1);
    },
  },
  splitTransaction: {
    input: () => ({
      id: aTransactionId,
      clientId: randomUUID(),
      parts: [
        { amountMinor: 20_000n, categoryId: null },
        { amountMinor: 30_000n, categoryId: null },
      ],
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('splitTransaction', input);
      expect(await count('transactions', `split_parent_id = '${aTransactionId}'`)).toBe(0);
      const split = await as<Result<{ partIds: string[] }>>('B', 'splitTransaction', {
        id: bTransactionId,
        clientId: randomUUID(),
        parts: [
          { amountMinor: 10_000n, categoryId: null },
          { amountMinor: 15_000n, categoryId: null },
        ],
      });
      expect(split.ok && split.value.partIds).toHaveLength(2);
    },
  },
  unsplitTransaction: {
    input: () => ({ id: aTransactionId }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('unsplitTransaction', input);
      expect(await as('B', 'unsplitTransaction', { id: bTransactionId })).toMatchObject({ ok: true });
      expect(await isDeleted(bTransactionId)).toBe(false);
    },
  },
  bulkSetCategory: {
    input: () => ({ ids: [aTransactionId], categoryId: null }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      // "Kategori B" was deleted by the deleteCategory case; B's budgeted category is still there.
      const categoryOfB = await categoryId(bId, 'Anggaran tag-b');
      expect(await as('B', 'bulkSetCategory', input)).toEqual(ok({ updated: [] }));
      expect(
        await as('B', 'bulkSetCategory', { ids: [bTransactionId, aTransactionId], categoryId: categoryOfB }),
      ).toEqual(ok({ updated: [bTransactionId] }));
      const categories = await superuser<{ category_id: string | null }[]>`
        SELECT category_id::text FROM transactions WHERE id = ${aTransactionId}`;
      expect(categories).toEqual([{ category_id: null }]);
      // A's category is not B's to use.
      expect(
        await as('B', 'bulkSetCategory', {
          ids: [bTransactionId],
          categoryId: await categoryId(aId, A_LEDGER.category),
        }),
      ).toMatchObject({ ok: false });
    },
  },
  bulkMoveAccount: {
    input: () => ({ ids: [aTransactionId], accountId: bAccountId }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const accountsOf = async (id: string) =>
        (
          await superuser<{ account_id: string }[]>`SELECT account_id::text FROM postings WHERE transaction_id = ${id}`
        ).map((row) => row.account_id);
      expect(await as('B', 'bulkMoveAccount', input)).toEqual(ok({ updated: [] }));
      expect(await accountsOf(aTransactionId)).toEqual([aAccountId]);
      await notFoundForB('bulkMoveAccount', { ids: [bTransactionId], accountId: aAccountId });
      expect(await accountsOf(bTransactionId)).toEqual([bAccountId]);
    },
  },
  bulkAddTag: {
    input: () => ({ ids: [aTransactionId], tag: 'tag-b' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const before = await aLedgerRows();
      expect(await as('B', 'bulkAddTag', input)).toEqual(ok({ updated: [] }));
      expect(await as('B', 'bulkAddTag', { ids: [bTransactionId, aTransactionId], tag: 'tag-b' })).toEqual(
        ok({ updated: [bTransactionId] }),
      );
      expect(await aLedgerRows()).toEqual(before);
    },
  },
  addAttachment: {
    input: () => {
      const form = new FormData();
      form.set('transactionId', aTransactionId);
      form.set('kind', 'image');
      form.set('file', new File([new Uint8Array([137, 80, 78, 71])], 'struk.png', { type: 'image/png' }));
      return form;
    },
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      // Refused before the image is read or anything reaches storage.
      await notFoundForB('addAttachment', input);
      expect(await count('attachments')).toBe(0);
    },
  },
  removeAttachment: {
    input: () => ({ id: SOME_ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      // A's receipt (row only: B's request must be refused before storage is touched).
      const attachmentOfA =
        (
          await superuser<{ id: string }[]>`
          INSERT INTO attachments (user_id, transaction_id, bucket, object_key, mime, size, sha256, kind)
          VALUES (${aId}, ${aTransactionId}, 'attachments', ${`u/${aId}/${randomUUID()}`}, 'image/webp', 10,
            ${'a'.repeat(64)}, 'receipt')
          RETURNING id::text`
        )[0]?.id ?? '';
      await notFoundForB('removeAttachment', { id: attachmentOfA });
      expect(await count('attachments', `id = '${attachmentOfA}'`)).toBe(1);
      const detail = await as<Result<TransactionDetail>>('A', 'getTransactionDetail', { id: aTransactionId });
      expect(detail.ok && detail.value.attachments.map((attachment) => attachment.id)).toEqual([attachmentOfA]);
    },
  },
  saveTablePrefs: {
    input: () => ({ columns: [{ id: 'amount', visible: true }], density: 'compact' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      expect(await as('B', 'saveTablePrefs', input)).toMatchObject(ok({ density: 'compact' }));
      expect(await count('user_preferences', `user_id = '${bId}'`)).toBe(1);
      expect(await count('user_preferences', `user_id = '${aId}'`)).toBe(0);
      const ofA = await as<Result<TransactionsView>>('A', 'getTransactionsView', { range: OCTOBER });
      expect(ofA.ok && ofA.value.prefs.density).toBe('comfortable');
    },
  },
  countPeriodTransactions: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const { current } = await services.periods.list(bId);
      const own = await count(
        'transactions',
        `user_id = '${bId}' AND deleted_at IS NULL AND local_date BETWEEN '${current.start}' AND '${current.end}'`,
      );
      expect(await as('B', 'countPeriodTransactions')).toEqual(ok(own));
    },
  },
  // FR-A4 (last: they move B through and out of the onboarding; A, the admin, never started it).
  getOnboarding: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const ofB = await as<Result<OnboardingView>>('B', 'getOnboarding');
      if (!ofB.ok) throw new Error(`getOnboarding failed: ${ofB.code}`);
      expect(ofB.value).toMatchObject({
        email: B.email,
        progress: { step: 'profile', completedAt: null },
        signIn: { google: false, password: true },
      });
      expect(ofB.value.accounts.accounts.map((account) => account.id)).toEqual(
        await idsOf('accounts', bId, `status = 'active'`),
      );
    },
  },
  saveOnboardingProfile: {
    input: () => ({
      name: 'Budi S.',
      nickname: 'Budi',
      locale: 'id',
      timezone: 'Asia/Jakarta',
      baseCurrency: 'IDR',
      extraCurrencies: ['USD', 'SGD'],
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await onboardingRows(aId);
      expect(await as('B', 'saveOnboardingProfile', input)).toMatchObject(ok({ step: 'period' }));
      expect(await onboardingRows(bId)).toMatchObject({
        user: { onboarding_step: 2, base_currency: 'IDR', nickname: 'Budi' },
        extras: [{ extra_currencies: ['USD', 'SGD'] }],
      });
      // B has accounts: another base currency is refused (FR-ST1).
      expect(await as('B', 'saveOnboardingProfile', { ...(input as object), baseCurrency: 'SGD' })).toEqual({
        ok: false,
        code: 'ACCOUNT_LOCKED',
      });
      expect(await onboardingRows(aId)).toEqual(a);
    },
  },
  saveOnboardingPeriod: {
    input: () => ({ day: 1, expectedIncomeMinor: 25_800_000n }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = { budget: await aBudgetRows(), onboarding: await onboardingRows(aId) };
      expect(await as('B', 'saveOnboardingPeriod', input)).toMatchObject(ok({ step: 'accounts' }));
      const { current } = await services.periods.list(bId);
      expect(await services.budgets.status(bId)).toMatchObject({
        version: { effectiveFrom: current.label, expectedIncomeMinor: 25_800_000n },
      });
      expect({ budget: await aBudgetRows(), onboarding: await onboardingRows(aId) }).toEqual(a);
    },
  },
  saveOnboardingAccounts: {
    input: () => ({
      accounts: [
        {
          id: aAccountId,
          type: 'bank',
          providerName: 'BCA',
          displayName: 'Pwned',
          currency: 'IDR',
          openingBalanceMinor: 1n,
          color: 'blue',
        },
      ],
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const before = await aLedger();
      await notFoundForB('saveOnboardingAccounts', input);
      const row = { type: 'ewallet', providerName: 'GoPay', currency: 'IDR', color: 'green' };
      expect(
        await as('B', 'saveOnboardingAccounts', {
          accounts: [{ ...row, displayName: 'GoPay B', openingBalanceMinor: 412_000n }],
        }),
      ).toMatchObject(ok({ baseCurrency: 'IDR' }));
      expect(await bAccountNames()).toContain('GoPay B:active');
      expect(await onboardingRows(bId)).toMatchObject({ user: { onboarding_step: 4 } });
      expect(await aLedger()).toEqual(before);
    },
  },
  saveOnboardingGoal: {
    input: () => ({
      preset: 'emergency',
      name: 'Dana Darurat',
      targetMinor: 54_000_000n,
      accountId: aAccountId,
      contribution: null,
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await onboardingRows(aId);
      // A's account is no account of B's: neither "Simpan di" nor the source of a contribution.
      expect(await as('B', 'saveOnboardingGoal', input)).toEqual({ ok: false, code: 'INVALID_GOAL' });
      expect(
        await as('B', 'saveOnboardingGoal', {
          ...(input as object),
          accountId: bAccountId,
          contribution: { amountMinor: 500_000n, monthDay: 1, fromAccountId: aAccountId },
        }),
      ).toEqual({ ok: false, code: 'INVALID_RECURRENCE' });
      expect(await count('goals', `user_id = '${bId}'`)).toBe(0);
      const gopay = (await idsOf('accounts', bId, `display_name = 'GoPay B'`))[0];
      expect(
        await as('B', 'saveOnboardingGoal', {
          ...(input as object),
          accountId: bAccountId,
          contribution: { amountMinor: 50_000n, monthDay: 1, fromAccountId: gopay },
        }),
      ).toMatchObject(ok({ name: 'Dana Darurat', accountId: bAccountId }));
      const rows = await onboardingRows(bId);
      expect(rows.goals).toHaveLength(1);
      expect(rows.recurrences.at(-1)).toMatchObject({
        template: expect.objectContaining({
          type: 'transfer',
          fromAccountId: gopay,
          toAccountId: bAccountId,
        }) as object,
      });
      expect(await onboardingRows(aId)).toEqual(a);
    },
  },
  skipOnboardingGoal: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await onboardingRows(aId);
      expect(await as('B', 'skipOnboardingGoal')).toMatchObject(ok({ step: 'done', completedAt: null }));
      expect(await onboardingRows(aId)).toEqual(a);
    },
  },
  finishOnboarding: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await onboardingRows(aId);
      expect(await as('B', 'finishOnboarding')).toMatchObject(
        ok({ step: 'done', completedAt: expect.any(Date) as Date }),
      );
      expect((await onboardingRows(bId)).user?.['onboarding_completed_at']).toBeInstanceOf(Date);
      expect(await onboardingRows(aId)).toEqual(a);
      expect((await onboardingRows(aId)).user?.['onboarding_completed_at']).toBeNull();
      // Completed: the onboarding writes are closed to B.
      expect(await as('B', 'skipOnboardingGoal')).toEqual(FORBIDDEN);
    },
  },
};

/**
 * Every server function the app defines: the exports of each source file that calls `createServerFn(`. Under
 * `serverFnModule()` a server function is its handler with an own `validator` property.
 */
async function serverFunctions(): Promise<{ id: string; fn: unknown }[]> {
  const found: { id: string; fn: unknown }[] = [];
  const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.endsWith('.d.ts'))
    .sort();
  for (const file of files) {
    const calls = readFileSync(path.join(SRC, file), 'utf8').match(/\bcreateServerFn\(/g)?.length ?? 0;
    if (calls === 0) continue;
    // The module path is discovered at run time, so it cannot be a static import.
    const module = (await import(path.join(SRC, file))) as Record<string, unknown>;
    const exported = Object.entries(module).filter(
      ([, value]) => typeof value === 'function' && Object.hasOwn(value, 'validator'),
    );
    // A server function that is not exported cannot be found here; make it visible instead of skipping it.
    if (exported.length !== calls) found.push({ id: `${file}: ${String(calls)} createServerFn calls`, fn: null });
    for (const [name, fn] of exported) found.push({ id: `${file}#${name}`, fn });
  }
  return found;
}

describe('tenant isolation at the API', () => {
  it('has a case for every server function', async () => {
    const all = await serverFunctions();
    expect(all.map(({ id }) => id)).toContain('server/fn/account.ts#getProfile');
    expect(all.map(({ id }) => id)).toContain('server/get-preferences.ts#getPreferences');
    const covered = new Set<unknown>((Object.keys(MATRIX) as Name[]).map((name) => FUNCTIONS[name]));
    const missing = all.filter(({ fn }) => !covered.has(fn)).map(({ id }) => id);
    expect(missing, 'server functions without an isolation case').toEqual([]);
    expect(all).toHaveLength(covered.size);
  });

  for (const [name, entry] of Object.entries(MATRIX) as [Name, Case][]) {
    it(`${name}: B sees and changes only B's data; signed out is refused`, async () => {
      const input = entry.input?.();
      expect(await as('anonymous', name, input)).toEqual(entry.anonymous());
      await entry.asB(input);
    });
  }

  it('never answers with an `_enc` field, a secret, or (to B and signed-out visitors) any of A’s data', async () => {
    const forbidden = [...secrets, ...(await storedSecrets())];
    const ofA = await aIdentifiers();
    expect(new Set(responses.map(({ caller }) => caller))).toEqual(new Set(['A', 'B', 'anonymous']));

    const encKeys = (value: unknown, at: string): string[] => {
      if (typeof value !== 'object' || value === null) return [];
      return Object.entries(value).flatMap(([key, child]) => [
        ...(/(?:_enc|Enc)$/.test(key) ? [`${at}.${key}`] : []),
        ...encKeys(child, `${at}.${key}`),
      ]);
    };
    for (const { caller, fn, value } of responses) {
      const json = toJson(value);
      expect(encKeys(value, `${caller} ${fn}`)).toEqual([]);
      expect(forbidden.filter((text) => json.includes(text)).length, `${caller} ${fn} leaks a secret`).toBe(0);
      if (caller !== 'A')
        expect(
          ofA.filter((text) => json.includes(text)),
          `${caller} ${fn}`,
        ).toEqual([]);
    }
  });
});
