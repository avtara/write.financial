// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FR-I5 / FR-G6 price status of the portfolio: the header pill with the newest price time and its label ("harga
 * 16.42 WIB · manual", never "real-time"), and the notice when some prices are missing or old (design `KR0zN`,
 * `TZxs4`): unpriced holdings are valued at cost, stale ones at their last price with its date — the page renders
 * either way, with "Coba lagi".
 */
import type { AssetView } from '@wf/db/investments';
import type { ResolvedQuote } from '@wf/domain/market';
import type { LocalDate } from '@wf/domain/period';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate, formatTime, toLocalDate } from '@wf/ui/dates';
import { CircleAlert, RotateCw } from 'lucide-react';
import { Button } from '../form.tsx';
import { quoteLabel, type QuoteStatus } from './investments-model.ts';

/** "16.42 WIB" today, "14 Okt, 16.42" another day. */
export function quoteTime(quote: Pick<ResolvedQuote, 'asOf'>, today: LocalDate, timeZone: string, locale: Locale) {
  const instant = new Date(quote.asOf);
  const time = formatTime(instant, timeZone, locale);
  if (toLocalDate(instant, timeZone) !== today) {
    return `${formatDate(toLocalDate(instant, timeZone), locale, 'day')}, ${time}`;
  }
  const zone = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' })
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value;
  return zone === undefined ? time : `${time} ${zone}`;
}

export interface PriceStatusPillProps {
  readonly status: QuoteStatus;
  readonly today: LocalDate;
  readonly timeZone: string;
  readonly locale: Locale;
}

export function PriceStatusPill({ status, today, timeZone, locale }: PriceStatusPillProps) {
  const { newest } = status;
  const warn = newest === null || status.unpriced.length > 0 || status.stale.length > 0;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[5px] px-1.5 py-0.5 font-mono text-[11px] ${warn ? 'bg-amber-tint-2 text-amber-fg' : 'bg-green-tint-2 text-green-fg'}`}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${warn ? 'bg-amber' : 'bg-green'}`} />
      {newest === null
        ? m.invest_price_none()
        : `${m.invest_price_at({ time: quoteTime(newest, today, timeZone, locale) })} · ${quoteLabel(newest.label)}`}
    </span>
  );
}

const symbols = (assets: readonly AssetView[]) =>
  assets.length <= 3
    ? assets.map((asset) => asset.symbol).join(', ')
    : `${assets
        .slice(0, 3)
        .map((asset) => asset.symbol)
        .join(', ')} +${String(assets.length - 3)}`;

export interface PriceFallbackProps {
  readonly status: QuoteStatus;
  readonly today: LocalDate;
  readonly timeZone: string;
  readonly locale: Locale;
  readonly retrying: boolean;
  readonly onRetry: () => void;
}

/** Shown while some held asset has no price or an old one; `null` otherwise. */
export function PriceFallback({ status, today, timeZone, locale, retrying, onRetry }: PriceFallbackProps) {
  if (status.unpriced.length === 0 && status.stale.length === 0) return null;
  const oldest = status.stale.reduce<ResolvedQuote | null>((first, asset) => {
    const quote = asset.quote as ResolvedQuote;
    return first === null || quote.asOf < first.asOf ? quote : first;
  }, null);
  return (
    <section
      role="status"
      aria-label={m.invest_fallback_label()}
      className="flex flex-wrap items-center gap-3 rounded-[12px] border border-amber-tint-3 bg-amber-tint-1 px-4 py-3"
    >
      <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-amber-fg" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-[13px] font-medium text-fg">
          {status.unpriced.length > 0 ? m.invest_fallback_missing_title() : m.invest_fallback_stale_title()}
        </p>
        <p className="text-[12.5px] text-muted-fg">
          {[
            status.unpriced.length > 0 ? m.invest_fallback_missing({ symbols: symbols(status.unpriced) }) : null,
            oldest === null
              ? null
              : m.invest_fallback_stale({
                  symbols: symbols(status.stale),
                  time: quoteTime(oldest, today, timeZone, locale),
                }),
          ]
            .filter((part) => part !== null)
            .join(' ')}
        </p>
      </div>
      <Button variant="secondary" size="sm" pending={retrying} onClick={onRetry}>
        <RotateCw aria-hidden="true" className="size-3.5" />
        {m.invest_retry()}
      </Button>
    </section>
  );
}
