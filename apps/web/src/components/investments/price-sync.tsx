// SPDX-License-Identifier: AGPL-3.0-only
/** FR-I5: observable per-source results and the shared API request log; never clears cached prices on failure. */
import { useNavigate } from '@tanstack/react-router';
import type { ApiLogView } from '@wf/db/market-data';
import type { LocalDate } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { KeyRound, ScrollText } from 'lucide-react';
import { useState } from 'react';
import { SYNC_MARKETS, type SyncMarket } from '../../lib/market-sources.ts';
import { getMarketApiLog, type MarketSyncResult } from '../../server/fn/market.ts';
import { FormError } from '../form.tsx';
import { Modal } from '../modal.tsx';
import type { HeaderAction } from '../page-header.tsx';
import { ApiLog, syncText } from '../settings/market-section.tsx';
import { openSettings } from '../settings/settings-sections.ts';
import { marketLabel } from './investments-model.ts';
import { quoteTime } from './price-status.tsx';

export interface PriceSyncState {
  readonly current: SyncMarket | null;
  readonly results: readonly MarketSyncResult[];
}

/** The API request log opened from the header: its entries while open, and whether the last load failed. */
export interface MarketLog {
  readonly entries: ApiLogView[] | null;
  readonly failed: boolean;
  readonly close: () => void;
}

/**
 * "Atur API harga" and "Buka log API" as the page header's secondary actions (FR-TB3: buttons from 1024 px, the ⋯
 * menu below), and the log they open for `PriceSyncStatus`.
 */
export function usePriceSyncActions(): { readonly actions: readonly HeaderAction[]; readonly log: MarketLog } {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<ApiLogView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const openLog = async () => {
    setFailed(false);
    const result = await getMarketApiLog({ data: {} }).catch(() => null);
    if (result?.ok === true) setEntries(result.value);
    else setFailed(true);
  };
  return {
    actions: [
      { label: m.invest_market_settings(), icon: KeyRound, onSelect: () => void navigate(openSettings('market')) },
      { label: m.market_open_log(), icon: ScrollText, onSelect: () => void openLog() },
    ],
    log: {
      entries,
      failed,
      close: () => {
        setEntries(null);
      },
    },
  };
}

export function PriceSyncStatus({
  state,
  log,
  today,
  timeZone,
  locale,
}: {
  readonly state: PriceSyncState | null;
  readonly log: MarketLog;
  readonly today: LocalDate;
  readonly timeZone: string;
  readonly locale: Locale;
}) {
  const time = (date: Date) => quoteTime({ asOf: date.getTime() }, today, timeZone, locale);
  return (
    <>
      {state === null && !log.failed ? null : (
        <section aria-label={m.invest_sync_sources()} className="flex flex-col gap-2">
          {state === null ? null : (
            <div role="status" className="rounded-[12px] border border-border bg-card px-4 py-3 text-[12.5px]">
              <ul className="flex flex-wrap gap-x-5 gap-y-2">
                {state.results.map((result) => (
                  <li key={result.market} className="text-muted-fg">
                    <span className="font-medium text-fg">{marketLabel(result.market)}</span>
                    {' · '}
                    {syncText(result, time)}
                  </li>
                ))}
                {state.current === null ? null : (
                  <li className="text-fg">
                    {marketLabel(state.current)}
                    {' · '}
                    {m.market_sync_progress({ done: state.results.length + 1, total: SYNC_MARKETS.length })}
                  </li>
                )}
              </ul>
            </div>
          )}
          {log.failed ? <FormError>{m.market_log_failed()}</FormError> : null}
        </section>
      )}
      <Modal open={log.entries !== null} onOpenChange={log.close} title={m.market_log_title()} size="xl">
        {log.entries === null ? null : <ApiLog entries={log.entries} time={time} />}
      </Modal>
    </>
  );
}
