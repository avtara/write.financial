// SPDX-License-Identifier: AGPL-3.0-only
import {
  FALLBACK_ORDER,
  refreshPlan,
  STALE_AFTER_MS,
  type ByokProvider,
  type CredentialStatus,
} from '@wf/domain/market';
import { syncByokMarket, type MarketTarget } from '@wf/integrations/market/sync';
import { JOBS } from '@wf/jobs/queues';
import type { ProcessorDeps, ProcessorJob } from '../processors.ts';
import { isRefreshDue } from './market-schedule.ts';

/** One market's outcome: who priced how much, which keys failed or waited. */
export interface MarketByokOutcome {
  readonly market: MarketTarget['market'];
  readonly priced: number;
  readonly missing: number;
  readonly runs: { readonly provider: ByokProvider; readonly status: CredentialStatus }[];
  readonly skipped: ByokProvider[];
}

export interface MarketByokResult {
  /** Markets refreshed; markets not due, without a usable key, or fully priced by the built-in source are left out. */
  readonly markets: MarketByokOutcome[];
}

/**
 * A user's own-key prices (plan §6 `market-byok`, FR-I6 BYOK), enqueued by the dispatch every 5 minutes for users with
 * an active key. Per fetched market with priced assets: the first active, unpaused key in `FALLBACK_ORDER` sets the
 * pace (`refreshPlan` within its free quota, placed in market hours by `isRefreshDue`); when due, the market's keys are
 * tried in order for the symbols still unpriced (`syncByokMarket`), the results stored for this user only. Crypto and
 * gold ask a user's key only for symbols the built-in source has no fresh price for. Failures keep the last prices
 * and pause the key after a 429 or an exhausted quota; the job itself succeeds, so nothing is retried early.
 */
export function createMarketByokProcessor({
  db,
  now,
  market: { adapters },
}: ProcessorDeps): (job: ProcessorJob) => Promise<MarketByokResult> {
  return async (job) => {
    const { userId } = JOBS['market-byok'].parse(job.data);
    const at = now();
    const keys = (await db.marketCredentials.list(userId)).filter(
      (key) => key.active && (key.retryAfter === null || key.retryAfter <= at),
    );
    const targets = await db.marketJobs.userTargets(userId, { fetchedOnly: true });
    const lastRequests = await db.marketJobs.lastRequests(userId);
    const ports = {
      credential: db.marketJobs.credential,
      setStatus: db.marketCredentials.setStatus,
      recordUserQuotes: db.marketData.recordUserQuotes,
      logRequest: db.marketData.logRequest,
    };
    const markets: MarketByokOutcome[] = [];
    for (const market of [...new Set(targets.map((target) => target.market))]) {
      const lead = FALLBACK_ORDER[market].find(
        (step) => step.mode === 'byok' && keys.some((key) => key.provider === step.provider),
      )?.provider as ByokProvider | undefined;
      const stale = targets.filter(
        (target) =>
          target.market === market &&
          (target.serverAsOf === null || at.getTime() - target.serverAsOf.getTime() > STALE_AFTER_MS[market]),
      );
      if (lead === undefined || stale.length === 0) continue;
      const plan = refreshPlan(lead, market, stale.length);
      if (plan === null || !isRefreshDue(market, plan, lastRequests[lead] ?? null, at)) continue;
      const sync = await syncByokMarket(ports, adapters, { userId, market, targets: stale, now: at });
      const priced = sync.results.filter((result) => result.price !== null).length;
      markets.push({
        market,
        priced,
        missing: sync.results.length - priced,
        runs: sync.runs.map((run) => ({ provider: run.provider, status: run.status })),
        skipped: sync.skipped.map((skip) => skip.provider),
      });
    }
    return { markets };
  };
}
