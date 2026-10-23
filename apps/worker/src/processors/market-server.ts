// SPDX-License-Identifier: AGPL-3.0-only
import { JOBS } from '@wf/jobs/queues';
import { syncServerProvider, type ServerRun } from '@wf/integrations/market/sync';
import type { ProcessorDeps, ProcessorJob } from '../processors.ts';

export interface MarketServerResult extends ServerRun {
  /** Symbols × currencies asked. */
  readonly asked: number;
}

/** The built-in gold source failed outright: nothing new was stored, so BullMQ retries the run. */
export class GoldSpotUnavailableError extends Error {
  override readonly name = 'GoldSpotUnavailableError';
}

/**
 * Built-in market prices (plan §6 `market-server`, FR-I6): `crypto` asks CoinMarketCap with the operator's key
 * (`CMC_API_KEY`) once per quote currency for the union of every user's fetched crypto symbols, every 5 minutes;
 * `gold` reads fawazahmed0's daily XAU spot (the Antam estimate's base). Prices go to the global cache only. A 429
 * pauses the source until `Retry-After`; CoinMarketCap stops short of its monthly credits. A failed crypto run is not
 * retried (the next one is 5 minutes away); a failed gold run is. Upserting by data minute makes reruns harmless.
 */
export function createMarketServerProcessor({
  db,
  now,
  market,
}: ProcessorDeps): (job: ProcessorJob) => Promise<MarketServerResult> {
  return async (job) => {
    const { source } = JOBS['market-server'].parse(job.data);
    const at = now();
    // The daily gold run also applies the request log's physical 30-day retention.
    if (source === 'gold') await db.marketJobs.purgeLogs(at);
    const wanted = source === 'crypto' ? 'crypto' : 'gold_spot';
    const requests = (await db.marketJobs.serverTargets())
      .filter((target) => target.market === wanted)
      .map(({ symbol, currency }) => ({ symbol, currency }));
    const ports = {
      providerState: db.marketJobs.providerState,
      setProviderState: db.marketJobs.setProviderState,
      recordServerQuotes: db.marketData.recordServerQuotes,
      logRequest: db.marketData.logRequest,
    };
    const run =
      source === 'crypto'
        ? await syncServerProvider(ports, market.adapters.coinmarketcap, {
            provider: 'coinmarketcap',
            apiKey: market.cmcApiKey,
            requests,
            now: at,
          })
        : await syncServerProvider(ports, market.adapters.fawazahmed0, {
            provider: 'fawazahmed0',
            apiKey: null,
            requests,
            now: at,
          });
    if (source === 'gold' && run.status === 'error') {
      throw new GoldSpotUnavailableError('fawazahmed0 answered no XAU spot; the last price stays in use');
    }
    return { ...run, asked: requests.length };
  };
}
