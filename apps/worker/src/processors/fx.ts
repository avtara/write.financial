// SPDX-License-Identifier: AGPL-3.0-only
import type { FxProvider, FxProviderName } from '@wf/integrations/fx/provider';
import { DEFAULT_FX_BASES, fetchReferenceRates, type FxFetchResult } from '@wf/integrations/fx/rates';
import { JOBS } from '@wf/jobs/queues';
import type { ProcessorDeps, ProcessorJob } from '../processors.ts';

/** Rates are quoted in the instance's primary currency; changing it once data exists is out of scope for v1 (FR-ST1). */
export const FX_QUOTE = 'IDR';

export interface FxResult {
  /** Rows written per source. */
  readonly written: Partial<Record<FxProviderName, number>>;
  /** Bases no source answered; they keep their last stored rate (FR-T4). */
  readonly missing: string[];
  readonly failures: FxFetchResult['failures'];
}

/** Every source failed: nothing was written, so the job fails and BullMQ retries it with backoff. */
export class FxUnavailableError extends Error {
  override readonly name = 'FxUnavailableError';
}

/**
 * Built-in FX reference rates (plan §6 `fx`): fetches IDR rates for the default bases plus every currency in use,
 * from the first source that answers each, and upserts them as global `fx_rates` rows. Upserting by publication day
 * makes a retry or a second run the same day harmless. A run that gets no rate at all fails (and is retried); a run
 * that misses some bases succeeds, and those bases keep their last rate.
 */
export function createFxProcessor(
  { db }: ProcessorDeps,
  providers: readonly FxProvider[],
): (job: ProcessorJob) => Promise<FxResult> {
  return async (job) => {
    JOBS.fx.parse(job.data);
    const bases = [...DEFAULT_FX_BASES, ...(await db.fxRates.currenciesInUse())];
    const { rates, missing, failures } = await fetchReferenceRates(providers, { quote: FX_QUOTE, bases });
    if (rates.length === 0) {
      const reasons = failures.map((failure) => failure.error).join('; ') || 'no source covers these currencies';
      throw new FxUnavailableError(`No FX reference rate available (${missing.join(', ')}): ${reasons}`);
    }
    await db.fxRates.upsertGlobal(rates);
    const written: FxResult['written'] = {};
    for (const { provider } of rates) written[provider] = (written[provider] ?? 0) + 1;
    return { written, missing, failures };
  };
}
