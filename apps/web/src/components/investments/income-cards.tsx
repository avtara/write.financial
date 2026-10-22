// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The bottom row of design 09 `bgmSP`: "Dividen & distribusi" (12 months of net dividends as bars, the total, and
 * the assets that paid them) and "Platform" (where the assets are kept, each platform's value with its cash, and a
 * note when most of the portfolio sits on one platform).
 */
import type { PortfolioView } from '@wf/db/investments';
import { ratioBps } from '@wf/domain/budget';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { Percent } from '@wf/ui/percent';
import { ShieldAlert } from 'lucide-react';
import { monthName } from '../dashboard/dashboard-format.ts';

/** Above this share of the portfolio on one platform, the card notes the concentration. */
const CONCENTRATION_BPS = 5000;

export function DividendsCard({ portfolio, locale }: { readonly portfolio: PortfolioView; readonly locale: Locale }) {
  const base = portfolio.baseCurrency;
  const { months, totalMinor } = portfolio.dividends;
  const top = months.reduce((max, month) => (month.minor > max ? month.minor : max), 1n);
  const columns = months.map((month, index) => ({
    month: month.month,
    height: Math.max((Number(month.minor) / Number(top)) * 48, month.minor > 0n ? 2 : 0),
    current: index === months.length - 1,
  }));
  const payers = portfolio.assets
    .filter((asset) => asset.holding.dividendBaseMinor > 0n)
    .sort((a, b) => (b.holding.dividendBaseMinor > a.holding.dividendBaseMinor ? 1 : -1));
  return (
    <section
      aria-labelledby="invest-dividends"
      className="flex min-w-0 flex-col gap-3 rounded-[12px] border border-border bg-card px-5 py-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="invest-dividends" className="text-[15px] font-semibold text-fg">
          {m.invest_dividends_title()}
        </h2>
        <p className="text-[12.5px] text-muted-fg">
          {m.invest_dividends_subtitle()} <Money minor={totalMinor} currency={base} context="amount" locale={locale} />
        </p>
      </div>
      <ul aria-hidden="true" className="grid grid-cols-12 items-end gap-1">
        {columns.map((column) => (
          <li key={column.month} className="flex flex-col items-center gap-1">
            <svg viewBox="0 0 10 48" preserveAspectRatio="none" className="block h-12 w-full">
              <rect width="10" height="48" rx="1" className="fill-surface-2" />
              <rect
                y={48 - column.height}
                width="10"
                height={column.height}
                rx="1"
                className={column.current ? 'fill-violet' : 'fill-neutral-mid'}
              />
            </svg>
            <span className="text-[10px] text-subtle">{monthName(column.month, locale).slice(0, 1)}</span>
          </li>
        ))}
      </ul>
      {payers.length === 0 ? (
        <p className="text-[12.5px] text-muted-fg">{m.invest_dividends_empty()}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {payers.map((asset) => (
            <li key={asset.id} className="flex items-center justify-between gap-2 text-[12.5px]">
              <span className="font-mono text-fg">{asset.symbol}</span>
              <Money
                minor={asset.holding.dividendBaseMinor}
                currency={base}
                context="amount"
                locale={locale}
                className="text-muted-fg"
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function PlatformsCard({ portfolio, locale }: { readonly portfolio: PortfolioView; readonly locale: Locale }) {
  const base = portfolio.baseCurrency;
  const total = portfolio.summary.valueBaseMinor;
  const rows = portfolio.platforms.map((platform) => ({
    platform,
    share: platform.valueBaseMinor === null ? null : ratioBps(platform.valueBaseMinor, total),
  }));
  const largest = rows.reduce<(typeof rows)[number] | null>(
    (best, row) => (row.share !== null && (best?.share ?? -1) < row.share ? row : best),
    null,
  );
  return (
    <section
      aria-labelledby="invest-platforms"
      className="flex min-w-0 flex-col gap-3 rounded-[12px] border border-border bg-card px-5 py-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="invest-platforms" className="text-[15px] font-semibold text-fg">
          {m.invest_platforms_title()}
        </h2>
        <p className="text-[12.5px] text-muted-fg">{m.invest_platforms_subtitle()}</p>
      </div>
      <ul className="flex flex-col">
        {rows.map(({ platform, share }) => (
          <li key={platform.accountId} className="flex flex-col gap-1.5 border-b border-border py-2.5 last:border-b-0">
            <span className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-medium text-fg">{platform.name}</span>
                <span className="text-[11.5px] text-subtle">
                  {m.invest_platforms_assets({ count: platform.assetCount })}
                  {platform.cashMinor === 0n ? null : (
                    <>
                      {' · '}
                      {m.invest_platforms_cash()}{' '}
                      <Money minor={platform.cashMinor} currency={platform.currency} context="amount" locale={locale} />
                    </>
                  )}
                </span>
              </span>
              <span className="flex flex-col items-end">
                {platform.valueBaseMinor === null ? (
                  <span className="text-subtle">—</span>
                ) : (
                  <Money
                    minor={platform.valueBaseMinor}
                    currency={base}
                    context="amount"
                    locale={locale}
                    className="text-[13px] text-fg"
                  />
                )}
                {share === null ? null : (
                  <Percent value={share / 10_000} locale={locale} className="text-[11px] text-subtle" />
                )}
              </span>
            </span>
            <svg aria-hidden="true" viewBox="0 0 100 3" preserveAspectRatio="none" className="block h-[3px] w-full">
              <rect width="100" height="3" rx="1.5" className="fill-surface-3" />
              <rect width={(share ?? 0) / 100} height="3" rx="1.5" className="fill-fg" />
            </svg>
          </li>
        ))}
      </ul>
      {largest?.share == null || largest.share < CONCENTRATION_BPS ? null : (
        <p className="mt-auto flex items-start gap-2 text-[12px] text-muted-fg">
          <ShieldAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-amber-fg" />
          {m.invest_platforms_concentration({
            share: new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
              largest.share / 10_000,
            ),
            platform: largest.platform.name,
          })}
        </p>
      )}
    </section>
  );
}
