// SPDX-License-Identifier: AGPL-3.0-only
/** FR-I5: observable per-source results and the shared API request log; never clears cached prices on failure. */
import { useNavigate } from '@tanstack/react-router';
import type { ApiLogView } from '@wf/db/market-data';
import type { LocalDate } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { useState } from 'react';
import { SYNC_MARKETS, type SyncMarket } from '../../lib/market-sources.ts';
import { getMarketApiLog, type MarketSyncResult } from '../../server/fn/market.ts';
import { Button, FormError } from '../form.tsx';
import { Modal } from '../modal.tsx';
import { ApiLog, syncText } from '../settings/market-section.tsx';
import { openSettings } from '../settings/settings-sections.ts';
import { marketLabel } from './investments-model.ts';
import { quoteTime } from './price-status.tsx';

export interface PriceSyncState {
  readonly current: SyncMarket | null;
  readonly results: readonly MarketSyncResult[];
}

export function PriceSyncStatus({ state, today, timeZone, locale }: {
  readonly state: PriceSyncState | null;
  readonly today: LocalDate;
  readonly timeZone: string;
  readonly locale: Locale;
}) {
  const navigate = useNavigate();
  const [log, setLog] = useState<ApiLogView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const time = (date: Date) => quoteTime({ asOf: date.getTime() }, today, timeZone, locale);
  const openLog = async () => {
    setLoading(true);
    setFailed(false);
    const result = await getMarketApiLog({ data: {} }).catch(() => null);
    setLoading(false);
    if (result?.ok === true) setLog(result.value);
    else setFailed(true);
  };
  return (
    <section aria-label={m.invest_sync_sources()} className="flex flex-col gap-2">
      {state === null ? null : (
        <div role="status" className="rounded-[12px] border border-border bg-card px-4 py-3 text-[12.5px]">
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {state.results.map((result) => (
              <li key={result.market} className="text-muted-fg">
                <span className="font-medium text-fg">{marketLabel(result.market)}</span>{' · '}{syncText(result, time)}
              </li>
            ))}
            {state.current === null ? null : (
              <li className="text-fg">
                {marketLabel(state.current)}{' · '}{m.market_sync_progress({done: state.results.length + 1, total: SYNC_MARKETS.length})}
              </li>
            )}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={() => void navigate(openSettings('market'))}>
          {m.invest_market_settings()}
        </Button>
        <Button size="sm" variant="secondary" pending={loading} onClick={() => void openLog()}>
          {m.market_open_log()}
        </Button>
      </div>
      {failed ? <FormError>{m.market_log_failed()}</FormError> : null}
      <Modal open={log !== null} onOpenChange={(open) => { if (!open) setLog(null); }} title={m.market_log_title()} size="xl">
        {log === null ? null : <ApiLog entries={log} time={time} />}
      </Modal>
    </section>
  );
}
