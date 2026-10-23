// SPDX-License-Identifier: AGPL-3.0-only
/** In-memory stand-ins for the worker's ports (Redis, BullMQ, the database, the log). */
import type { BuiltInRateInput } from '@wf/db/fx-rates';
import type { AuthPurgeCounts } from '@wf/db/maintenance';
import type { MarketCredentialView } from '@wf/db/market-credentials';
import type { MailMessage, Mailer } from '@wf/integrations/mailer';
import type { MarketAdapters, QuoteProvider } from '@wf/integrations/market/adapters';
import type { FetchQuotesInput } from '@wf/integrations/market/http';
import type { JobQueue } from '@wf/jobs/queues';
import type { DestinationStream } from 'pino';
import type { HeartbeatStore } from '../src/heartbeat.ts';
import type { Processor, ProcessorDeps, ProcessorJob } from '../src/processors.ts';
import type { Broker } from '../src/runtime.ts';
import type { WorkerDb } from '../src/worker-db.ts';

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
    reports: {
      pendingMonthly: method('reports.pendingMonthly', []),
      generate: method('reports.generate', { id: 'report' }),
    },
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
    market: { adapters: fakeAdapters(), cmcApiKey: 'fake-cmc-operator-key' },
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
