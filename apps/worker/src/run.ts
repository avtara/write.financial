// SPDX-License-Identifier: AGPL-3.0-only
import { hostname } from 'node:os';
import { loadConfig, type Config } from '@wf/config';
import { loadKeyring, type Keyring } from '@wf/crypto/keyring';
import { createInstanceMailer, sendWith } from '@wf/integrations/instance-mailer';
import { createMarketAdapters } from '@wf/integrations/market/adapters';
import type { DestinationStream } from 'pino';
import { HEARTBEAT, heartbeatKey, isHealthy, type HeartbeatSettings } from './heartbeat.ts';
import { createLogger } from './logger.ts';
import type { ConnectOptions } from './platform.ts';
import { startWorker, type Broker, type Runtime } from './runtime.ts';
import { openWorkerDb } from './worker-db.ts';

export type ShutdownSignal = 'SIGTERM' | 'SIGINT';

export interface RunDeps {
  /** `connectBroker` from platform.ts. */
  readonly connect: (url: string, options: ConnectOptions) => Broker;
  /** `process`: the first SIGTERM/SIGINT stops gracefully, a second one exits at once. */
  readonly signals: { on(signal: ShutdownSignal, listener: () => void): unknown };
  /** For problems before the logger exists (usage, configuration). */
  readonly output: { error(message: string): void };
  readonly hostname?: string;
  readonly now?: () => number;
  readonly heartbeat?: HeartbeatSettings;
  readonly shutdownTimeoutMs?: number;
  /** Log destination (default stdout). */
  readonly log?: DestinationStream;
}

const USAGE = 'Usage: wf-worker [--healthcheck]';

/** Docker sends SIGKILL after `stop_grace_period`; keep that above this value. */
export const SHUTDOWN_TIMEOUT_MS = 25_000;

/**
 * Runs the worker until SIGTERM/SIGINT, or with `--healthcheck` checks the heartbeat of the worker on this host, and
 * returns the process exit code: 0 ok, 1 failure (unhealthy, bad configuration, shutdown timed out or forced by a
 * second signal), 2 usage.
 */
export async function run(
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  deps: RunDeps,
): Promise<number> {
  const healthcheck = args.length === 1 && args[0] === '--healthcheck';
  if (args.length > 0 && !healthcheck) {
    deps.output.error(USAGE);
    return 2;
  }
  let config: Config;
  try {
    config = loadConfig(env);
  } catch (error) {
    deps.output.error(String(error));
    return 1;
  }
  const key = heartbeatKey(deps.hostname ?? hostname());
  const now = deps.now ?? Date.now;
  const heartbeat = deps.heartbeat ?? HEARTBEAT;
  return healthcheck
    ? checkHealth(config, deps, key, now, heartbeat.maxAgeMs)
    : work(config, deps, { ...heartbeat, key }, now);
}

async function checkHealth(
  config: Config,
  deps: RunDeps,
  key: string,
  now: () => number,
  maxAgeMs: number,
): Promise<number> {
  const broker = deps.connect(config.redis.url, { failFast: true, onError: () => undefined });
  try {
    return (await isHealthy(broker.store, key, now, maxAgeMs)) ? 0 : 1;
  } catch {
    return 1;
  } finally {
    await broker.close();
  }
}

async function work(
  config: Config,
  deps: RunDeps,
  heartbeat: HeartbeatSettings & { readonly key: string },
  now: () => number,
): Promise<number> {
  const logger = createLogger(config.log.level, deps.log);
  // User DEKs (encrypted review items) and the instance DEK (SMTP password) are wrapped with the KEK.
  let keyring: Keyring;
  try {
    keyring = await loadKeyring(config.crypto.kekFile);
  } catch (error) {
    logger.fatal({ err: error }, 'cannot load the key file');
    return 1;
  }
  const stop = Promise.withResolvers<ShutdownSignal>();
  const force = Promise.withResolvers<'forced'>();
  let stopping = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    deps.signals.on(signal, () => {
      if (stopping) force.resolve('forced');
      stopping = true;
      stop.resolve(signal);
    });
  }
  const stopRequested = stop.promise;

  const broker = deps.connect(config.redis.url, {
    failFast: false,
    onError: (error) => {
      logger.error({ err: error }, 'redis connection error');
    },
  });
  const database = openWorkerDb(config.db.workerUrl, keyring);
  // SMTP of the setup wizard when saved (looked up per email), else SMTP_URL/MAIL_FROM.
  const mailer = createInstanceMailer({ env: config.mail, smtp: database.smtp, send: sendWith });
  const closeConnections = async () => {
    mailer.close();
    await Promise.allSettled([broker.close(), database.close()]);
  };

  // A signal while starting (e.g. Redis not reachable yet) stops the start instead of waiting for it.
  const starting = startWorker({
    broker,
    db: database.db,
    mailer,
    publicUrl: config.publicUrl,
    // Every adapter checks the egress allowlist before a request.
    market: { adapters: createMarketAdapters(), cmcApiKey: config.market.cmcApiKey },
    logger,
    now,
    heartbeat,
  });
  let runtime: Runtime | null;
  try {
    runtime = await Promise.race([starting, stopRequested.then(() => null)]);
  } catch (error) {
    logger.fatal({ err: error }, 'worker failed to start');
    await closeConnections();
    return 1;
  }
  if (runtime === null) {
    starting.catch(() => undefined);
    logger.warn({ signal: await stopRequested }, 'stopped while starting');
    await closeConnections();
    return 1;
  }

  logger.info({ signal: await stopRequested }, 'shutting down');
  const forced = force.promise;
  const timeout = Promise.withResolvers<'timeout'>();
  const timer = setTimeout(timeout.resolve, deps.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT_MS, 'timeout');
  const stopped = runtime
    .stop()
    .then(
      () => 'stopped' as const,
      (error: unknown) => {
        logger.error({ err: error }, 'shutdown failed');
        return 'failed' as const;
      },
    )
    .then(async (result) => {
      await closeConnections();
      return result;
    });
  const outcome = await Promise.race([stopped, forced, timeout.promise]);
  clearTimeout(timer);
  if (outcome === 'stopped') {
    logger.info('worker stopped');
    return 0;
  }
  logger.error({ reason: outcome }, 'shutdown did not finish cleanly');
  return 1;
}
