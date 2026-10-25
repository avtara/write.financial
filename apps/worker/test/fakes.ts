// SPDX-License-Identifier: AGPL-3.0-only
/** In-memory stand-ins for the worker's ports (Redis, BullMQ, the database, the log). */
import type { BuiltInRateInput } from '@wf/db/fx-rates';
import type { AuthPurgeCounts } from '@wf/db/maintenance';
import type { MarketCredentialView } from '@wf/db/market-credentials';
import type { Preferences } from '@wf/db/preferences';
import type { ReportFileMeta } from '@wf/db/report-files';
import type { ReportView } from '@wf/db/reports';
import { DEFAULT_REPORT_EXPORT_OPTIONS } from '@wf/domain/report';
import type { MailMessage, Mailer } from '@wf/integrations/mailer';
import type { MarketAdapters, QuoteProvider } from '@wf/integrations/market/adapters';
import type { ObjectPurgePort } from '../src/processors.ts';
import type { FetchQuotesInput } from '@wf/integrations/market/http';
import type { JobQueue } from '@wf/jobs/queues';
import type { LocalDate } from '@wf/domain/period';
import type { DestinationStream } from 'pino';
import type { HeartbeatStore } from '../src/heartbeat.ts';
import type { Processor, ProcessorDeps, ProcessorJob } from '../src/processors.ts';
import type { Broker } from '../src/runtime.ts';
import type { WorkerDb } from '../src/worker-db.ts';

/** What `preferences.get` answers in fakes: the auto-send opt-in on, everything else irrelevant to processors. */
export const DEFAULT_REPORT_EXPORT_PREFERENCES = { reportAutoSend: true } as Preferences;

/** S3 settings that point nowhere; repositories only build clients with them, tests never store objects this way. */
export const FAKE_S3 = {
  endpoint: 'http://127.0.0.1:9',
  region: 'test',
  accessKeyId: 'test',
  secretAccessKey: 'test',
  buckets: { attachments: 'attachments', avatars: 'avatars', reports: 'reports', exports: 'exports' },
} as const;

export interface FakeStore extends HeartbeatStore {
  readonly entries: Map<string, { value: string; ttlMs: number }>;
  /** Makes the next `set` reject with this error. */
  failNextSet(error: Error): void;
}

export function fakeStore(): FakeStore {
  const entries = new Map<string, { value: string; ttlMs: number }>();
  let failure: Error | undefined;
  return {
    entries,
    failNextSet: (error) => {
      failure = error;
    },
    get: async (key) => Promise.resolve(entries.get(key)?.value ?? null),
    set: async (key, value, ttlMs) => {
      const error = failure;
      failure = undefined;
      if (error !== undefined) throw error;
      entries.set(key, { value, ttlMs });
      return Promise.resolve();
    },
    del: async (key) => {
      entries.delete(key);
      return Promise.resolve();
    },
  };
}

/** An object store reduced to what the account-deletion processor uses, recording the prefixes purged. */
export function fakePurgePort(): ObjectPurgePort & { readonly purged: string[] } {
  const purged: string[] = [];
  return {
    purged,
    deletePrefix: async (userId) => {
      purged.push(userId);
      return Promise.resolve(0);
    },
  };
}

export interface FakeQueue {
  readonly schedulers: Map<string, { repeat: object; template: object }>;
  /** Jobs added by id, as BullMQ keeps them: adding an existing id again is ignored. */
  readonly jobs: Map<string, { name: string; data: object }>;
  readonly onError: (error: Error) => void;
  closed: boolean;
}

export interface FakeWorker {
  readonly concurrency: number;
  readonly onError: (error: Error) => void;
  /** Runs a job through the registered processor, as BullMQ would. */
  run(job: ProcessorJob): Promise<object>;
  closed: boolean;
}

export interface FakeBroker extends Broker {
  readonly store: FakeStore;
  readonly queues: Map<JobQueue, FakeQueue>;
  readonly workers: Map<JobQueue, FakeWorker>;
  /** Order in which things were closed, e.g. `['worker:maintenance', 'queue:maintenance', 'broker']`. */
  readonly closed: string[];
}

export interface NextRun {
  readonly timestamp: number;
  readonly delay: number;
  readonly opts: { readonly prevMillis?: number };
}

/** The next job the fake scheduler reports: slot 2026-10-19 03:30 WIB, enqueued 12 ms "late" by the producer clock. */
export const NEXT_RUN: NextRun = {
  timestamp: Date.parse('2026-10-18T10:00:00.012Z'),
  delay: 9.5 * 60 * 60 * 1000,
  opts: { prevMillis: Date.parse('2026-10-18T19:30:00Z') },
};

export function fakeBroker(nextRun: NextRun = NEXT_RUN): FakeBroker {
  const store = fakeStore();
  const queues = new Map<JobQueue, FakeQueue>();
  const workers = new Map<JobQueue, FakeWorker>();
  const closed: string[] = [];
  return {
    store,
    queues,
    workers,
    closed,
    createQueue: (name, onError) => {
      const queue: FakeQueue = { schedulers: new Map(), jobs: new Map(), onError, closed: false };
      queues.set(name, queue);
      return {
        upsertJobScheduler: async (id, repeat, template) => {
          queue.schedulers.set(id, { repeat, template });
          return Promise.resolve(nextRun);
        },
        add: async (jobName, data, { jobId }) => {
          if (!queue.jobs.has(jobId)) queue.jobs.set(jobId, { name: jobName, data });
          return Promise.resolve();
        },
        close: async () => {
          queue.closed = true;
          closed.push(`queue:${name}`);
          return Promise.resolve();
        },
      };
    },
    createWorker: (name, processor: Processor, { concurrency, onError }) => {
      const running = new Set<Promise<unknown>>();
      const worker: FakeWorker = {
        concurrency,
        onError,
        closed: false,
        run: async (job) => {
          const result = processor(job);
          running.add(result);
          try {
            return await result;
          } finally {
            running.delete(result);
          }
        },
      };
      workers.set(name, worker);
      return {
        close: async () => {
          await Promise.allSettled(running);
          worker.closed = true;
          closed.push(`worker:${name}`);
        },
      };
    },
    close: async () => {
      closed.push('broker');
      return Promise.resolve();
    },
  };
}

export interface FakeDb extends WorkerDb {
  readonly purgeCalls: Date[];
  /** Every batch passed to `fxRates.upsertGlobal`. */
  readonly fxUpserts: (readonly BuiltInRateInput[])[];
  /** Calls of the M3 repositories, `repository.method` with the arguments, in order. */
  readonly calls: { readonly method: string; readonly args: readonly unknown[] }[];
}

export function fakeDb(
  counts: AuthPurgeCounts = { verifications: 2, sessions: 3, invitations: 1 },
  currenciesInUse: readonly string[] = ['IDR', 'USD'],
): FakeDb {
  const purgeCalls: Date[] = [];
  const fxUpserts: (readonly BuiltInRateInput[])[] = [];
  const calls: { method: string; args: readonly unknown[] }[] = [];
  /** A repository method that records its call and resolves to `result`. */
  const method =
    <R>(name: string, result: R) =>
    async (...args: unknown[]): Promise<R> => {
      calls.push({ method: name, args });
      return Promise.resolve(result);
    };
  return {
    purgeCalls,
    fxUpserts,
    calls,
    maintenance: {
      purgeExpiredAuth: async (now) => {
        purgeCalls.push(now);
        return Promise.resolve(counts);
      },
      purgeNotifications: method('maintenance.purgeNotifications', 5),
    },
    accountDeletion: {
      due: method('accountDeletion.due', [] as string[]),
      deleteUser: method('accountDeletion.deleteUser', true),
    },
    fxRates: {
      currenciesInUse: async () => Promise.resolve([...currenciesInUse]),
      upsertGlobal: async (rows) => {
        fxUpserts.push(rows);
        return Promise.resolve(rows.length);
      },
    },
    dispatch: {
      users: method('dispatch.users', []),
      dueReminders: method('dispatch.dueReminders', []),
      pendingOutbox: method('dispatch.pendingOutbox', []),
    },
    occurrences: {
      advance: method('occurrences.advance', { materialized: 3, due: 1, overdue: 0, notifications: 1 }),
      remind: method('occurrences.remind', { reminded: true, emailed: true }),
    },
    periods: { lock: method('periods.lock', { locked: true }) },
    periodClose: {
      endedPeriods: method('periodClose.endedPeriods', []),
      propose: method('periodClose.propose', { rollovers: 1, leftover: true, created: 2 }),
    },
    budgetAlerts: { check: method('budgetAlerts.check', { created: 2 }) },
    balanceChecks: { check: method('balanceChecks.check', { lowBalance: 1, unchecked: 0, insufficient: 0 }) },
    detectRecurring: { detect: method('detectRecurring.detect', { created: 1, updated: 0 }) },
    ruleBackfill: {
      preview: method('ruleBackfill.preview', {
        proposals: [],
        totals: { matched: 0, changes: 0, noops: 0, blocked: 0 },
        ruleIds: [],
        version: 'rules-version',
        truncated: false,
      }),
    },
    outbox: {
      get: method('outbox.get', null),
      markSent: method('outbox.markSent', true),
      markFailed: method('outbox.markFailed', undefined),
    },
    marketData: {
      recordServerQuotes: method('marketData.recordServerQuotes', undefined),
      recordUserQuotes: method('marketData.recordUserQuotes', undefined),
      logRequest: method('marketData.logRequest', undefined),
    },
    marketCredentials: {
      list: method('marketCredentials.list', []),
      setStatus: method('marketCredentials.setStatus', {} as MarketCredentialView),
    },
    marketJobs: {
      serverTargets: method('marketJobs.serverTargets', []),
      byokUsers: method('marketJobs.byokUsers', []),
      userTargets: method('marketJobs.userTargets', []),
      credential: method('marketJobs.credential', null),
      lastRequests: method('marketJobs.lastRequests', {}),
      providerState: method('marketJobs.providerState', null),
      setProviderState: method('marketJobs.setProviderState', undefined),
      purgeLogs: method('marketJobs.purgeLogs', 0),
      baselineExists: method('marketJobs.baselineExists', false),
    },
    portfolioSnapshots: { record: method('portfolioSnapshots.record', null) },
    goalSnapshots: { record: method('goalSnapshots.record', undefined) },
    reports: {
      pendingMonthly: method('reports.pendingMonthly', []),
      generate: method('reports.generate', { id: REPORT_ID }),
      get: method('reports.get', fakeReportView()),
    },
    reportFiles: {
      save: method('reportFiles.save', fakeReportFileMeta()),
      recipient: method('reportFiles.recipient', null),
    },
    preferences: { get: method('preferences.get', DEFAULT_REPORT_EXPORT_PREFERENCES) },
  };
}

const REPORT_ID = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c80';
const FILE_ID = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c81';

/** A report with every section populated and every optional field present, for the export builders. */
export function richReportView(): ReportView {
  return {
    id: REPORT_ID,
    kind: 'monthly',
    status: 'final',
    periodId: null,
    label: 'September 2026',
    range: { from: '2026-09-01' as LocalDate, to: '2026-09-30' as LocalDate },
    compare: { label: 'Agustus 2026', range: { from: '2026-08-01' as LocalDate, to: '2026-08-31' as LocalDate } },
    totals: {
      incomeMinor: 25_800_000n,
      expenseMinor: 18_300_000n,
      savedMinor: 7_500_000n,
      savingRateBps: 2_907,
      txCount: 121,
      netWorthMinor: 116_443_000n,
    },
    previous: null,
    delta: {
      incomeBps: 360,
      expenseBps: null,
      savedBps: -1_200,
      savingRatePoints: -180,
    },
    sections: {
      categories: [
        {
          categoryId: 'cat-1',
          name: 'Makan',
          group: 'needs',
          isFixed: false,
          spentMinor: 6_000_000n,
          shareBps: 3_279,
          limitMinor: 5_000_000n,
          usedBps: 12_000,
          overMinor: 1_000_000n,
        },
        {
          categoryId: 'cat-2',
          name: 'Transport',
          group: 'needs',
          isFixed: true,
          spentMinor: 900_000n,
          shareBps: 492,
          limitMinor: null,
          usedBps: null,
          overMinor: 0n,
        },
        {
          categoryId: null,
          name: null,
          group: null,
          isFixed: null,
          spentMinor: 400_000n,
          shareBps: 219,
          limitMinor: null,
          usedBps: null,
          overMinor: 0n,
        },
        // Over its limit without a computed share (the row predates the budget snapshot).
        {
          categoryId: 'cat-3',
          name: 'Belanja',
          group: 'wants',
          isFixed: false,
          spentMinor: 200_000n,
          shareBps: 109,
          limitMinor: 100_000n,
          usedBps: null,
          overMinor: 100_000n,
        },
      ],
      incomeSources: [
        { categoryId: 'inc-1', name: 'Gaji', group: 'active', totalMinor: 25_000_000n, shareBps: 9_690 },
        { categoryId: null, name: null, group: null, totalMinor: 800_000n, shareBps: 310 },
      ],
      merchants: [
        { merchant: 'Indomaret', totalMinor: 1_200_000n, count: 12, shareBps: 656 },
        { merchant: '"Kopi", Nugget & <Ayam>', totalMinor: 300_000n, count: 3, shareBps: 164 },
      ],
      tags: [{ tagId: 'tag-1', name: 'akhir-pekan', totalMinor: 500_000n, count: 5 }],
      accounts: [
        { accountId: 'acc-1', name: 'BCA 1234567890', type: 'bank', inMinor: 25_000_000n, outMinor: 10_000_000n },
        { accountId: 'acc-2', name: 'GoPay', type: 'ewallet', inMinor: 0n, outMinor: 150_000n },
      ],
      goals: [
        {
          goalId: 'goal-1',
          name: 'DP Rumah',
          currency: 'IDR',
          valuation: 'market',
          savedMinor: 14_100_000n,
          openingMinor: 12_000_000n,
          targetMinor: 70_000_000n,
          progressBps: 2_014,
        },
        {
          goalId: 'goal-2',
          name: 'Emergency fund',
          currency: 'IDR',
          valuation: 'cash',
          savedMinor: null,
          openingMinor: null,
          targetMinor: 30_000_000n,
          progressBps: null,
        },
      ],
      goalsAsOf: '2026-09-30' as LocalDate,
      largest: [
        {
          transactionId: 'tx-1',
          date: '2026-09-05' as LocalDate,
          description: 'Sewa Kos',
          merchant: null,
          amountMinor: 4_500_000n,
          shareBps: 2_459,
        },
        {
          transactionId: 'tx-2',
          date: '2026-09-12' as LocalDate,
          description: 'MacBook',
          merchant: 'Apple Store',
          amountMinor: 2_000_000n,
          shareBps: 1_093,
        },
      ],
      largestShareBps: 3_552,
      subscriptions: { active: 2, monthlyMinor: 904_900n, yearlyMinor: 11_520_000n, shareBps: 494, unconverted: 1 },
      days: [
        { date: '2026-09-30' as LocalDate, outMinor: 250_000n },
        { date: '2026-09-29' as LocalDate, outMinor: 0n },
      ],
      averageDailyMinor: 610_000n,
      busiestWeek: { from: '2026-09-05' as LocalDate, to: '2026-09-11' as LocalDate, totalMinor: 5_400_000n },
      netWorth: {
        valueMinor: 116_443_000n,
        cashMinor: 102_443_000n,
        investmentsMinor: 20_000_000n,
        debtMinor: 6_000_000n,
        missingPortfolio: false,
        asOf: '2026-09-30' as LocalDate,
        unvaluedCurrencies: [],
      },
      netWorthHistory: [
        { date: '2026-08-31' as LocalDate, valuation: null },
        {
          date: '2026-09-30' as LocalDate,
          valuation: {
            valueMinor: 116_443_000n,
            cashMinor: 102_443_000n,
            investmentsMinor: 20_000_000n,
            debtMinor: 6_000_000n,
            missingPortfolio: false,
            asOf: '2026-09-30' as LocalDate,
            unvaluedCurrencies: [],
          },
        },
      ],
    },
    generatedAt: new Date(0),
  };
}

/** A minimal stored report: every section empty, totals zero, so builders have all the branch shapes in one fixture. */
export function fakeReportView(): ReportView {
  return {
    id: REPORT_ID,
    kind: 'monthly',
    status: 'final',
    periodId: null,
    label: 'September 2026',
    range: { from: '2026-09-01' as LocalDate, to: '2026-09-30' as LocalDate },
    compare: null,
    totals: {
      incomeMinor: 0n,
      expenseMinor: 0n,
      savedMinor: 0n,
      savingRateBps: null,
      txCount: 0,
      netWorthMinor: null,
    },
    previous: null,
    delta: null,
    sections: {
      categories: [],
      incomeSources: [],
      merchants: [],
      tags: [],
      accounts: [],
      goals: [],
      goalsAsOf: null,
      largest: [],
      largestShareBps: null,
      subscriptions: { active: 0, monthlyMinor: 0n, yearlyMinor: 0n, shareBps: null, unconverted: 0 },
      days: [],
      averageDailyMinor: 0n,
      busiestWeek: null,
      netWorth: null,
      netWorthHistory: [],
    },
    generatedAt: new Date(0),
  };
}

export function fakeReportFileMeta(overrides: Partial<ReportFileMeta> = {}): ReportFileMeta {
  return {
    id: FILE_ID,
    reportId: REPORT_ID,
    format: 'pdf',
    options: DEFAULT_REPORT_EXPORT_OPTIONS,
    fileKey: `u/owner/${FILE_ID}`,
    sizeBytes: 4,
    createdAt: new Date(0),
    ...overrides,
  };
}

export interface FakeAdapters extends MarketAdapters {
  /** Every `fetchQuotes` call, `provider` with its input, in order. */
  readonly inputs: { readonly provider: QuoteProvider; readonly input: FetchQuotesInput }[];
}

/** Market adapters that answer nothing and record what they were asked (no network). */
export function fakeAdapters(): FakeAdapters {
  const inputs: FakeAdapters['inputs'][number][] = [];
  const providers: QuoteProvider[] = [
    'fawazahmed0',
    'coinmarketcap',
    'tiingo',
    'finnhub',
    'massive',
    'alpha_vantage',
    'eodhd',
    'marketstack',
    'coingecko',
    'goldapi',
    'metals_dev',
  ];
  return {
    inputs,
    ...(Object.fromEntries(
      providers.map((provider) => [
        provider,
        {
          provider,
          fetchQuotes: (input: FetchQuotesInput) => {
            inputs.push({ provider, input });
            return Promise.resolve({ quotes: [], calls: [], failure: null, unverified: false, credits: null });
          },
        },
      ]),
    ) as unknown as MarketAdapters),
  };
}

export interface FakeMailer extends Mailer {
  /** Every message sent, in order. */
  readonly sent: MailMessage[];
}

/** A mailer that keeps every message (or fails with `failure`). */
export function fakeMailer(failure?: Error): FakeMailer {
  const sent: MailMessage[] = [];
  return {
    sent,
    configured: true,
    send: async (message) => {
      if (failure !== undefined) throw failure;
      sent.push(message);
      return Promise.resolve();
    },
    close: () => undefined,
  };
}

export interface FakeDeps extends ProcessorDeps {
  readonly db: FakeDb;
  readonly mailer: FakeMailer;
  /** Every `enqueue` call. */
  readonly enqueued: { readonly queue: JobQueue; readonly payload: object; readonly jobId: string }[];
}

export function fakeDeps(overrides: Partial<ProcessorDeps> = {}, now = new Date('2026-10-18T02:00:00Z')): FakeDeps {
  const enqueued: { queue: JobQueue; payload: object; jobId: string }[] = [];
  return {
    db: fakeDb(),
    now: () => now,
    mailer: fakeMailer(),
    publicUrl: 'https://uang.example/',
    // A one-line PDF marker; the chromium renderer is the production port and stays out of unit tests.
    render: async (html) => Promise.resolve(new Uint8Array([0x25, 0x50, 0x44, 0x46, html.length % 256])),
    market: { adapters: fakeAdapters(), cmcApiKey: 'fake-cmc-operator-key' },
    objects: { attachments: fakePurgePort(), avatars: fakePurgePort() },
    enqueue: async (queue, payload, { jobId }) => {
      enqueued.push({ queue, payload, jobId });
      return Promise.resolve();
    },
    enqueued,
    ...(overrides as Partial<FakeDeps>),
  };
}

export interface LogCapture extends DestinationStream {
  readonly lines: Record<string, unknown>[];
  /** Messages (`msg`) in order. */
  messages(): string[];
}

/** A pino destination that keeps every line, parsed. */
export function captureLog(): LogCapture {
  const lines: Record<string, unknown>[] = [];
  return {
    lines,
    write: (line: string) => {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    },
    messages: () => lines.map((line) => String(line['msg'])),
  };
}
