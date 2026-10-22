// SPDX-License-Identifier: AGPL-3.0-only
/**
 * When a market's own-key prices are due (plan §6 `market-byok`: "market hours: US 15 minutes, IDX close +
 * 10.00/12.00/14.30 WIB"; research market-data §4.2.10). `refreshPlan` (`@wf/domain/market`) fixes how often a key's
 * free quota allows; this places those refreshes: an interval only during the session on trading days (Monday–Friday
 * for exchanges), a few fixed times a day otherwise — the close first, then the session's middle. A refresh missed
 * while the worker was down is made at the next check.
 */
import type { Market, RefreshPlan } from '@wf/domain/market';
import { addDays } from '@wf/domain/period';
import { zonedInstant } from '@wf/domain/recurrence';
import { localClock } from './dispatch.ts';

interface MarketHours {
  readonly timeZone: string;
  /** Session `HH:MM` in {@link timeZone}; the whole day for markets that never close. */
  readonly open: string;
  readonly close: string;
  readonly weekdaysOnly: boolean;
  /** Fixed refresh times in order of preference: the first `refreshesPerDay` are used. */
  readonly fixed: readonly string[];
}

/** Fetched markets' hours; FX, mutual funds, SBN, and Antam are never polled with a user's key. */
export const MARKET_HOURS: Readonly<Partial<Record<Market, MarketHours>>> = {
  us_equity: {
    timeZone: 'America/New_York',
    open: '09:30',
    close: '16:00',
    weekdaysOnly: true,
    fixed: ['16:15', '12:00', '10:00', '14:00'],
  },
  idx_equity: {
    timeZone: 'Asia/Jakarta',
    open: '09:00',
    close: '16:15',
    weekdaysOnly: true,
    fixed: ['16:15', '12:00', '10:00', '14:30'],
  },
  crypto: {
    timeZone: 'Asia/Jakarta',
    open: '00:00',
    close: '24:00',
    weekdaysOnly: false,
    fixed: ['09:00', '21:00', '15:00', '03:00'],
  },
  gold_spot: {
    timeZone: 'Asia/Jakarta',
    open: '00:00',
    close: '24:00',
    weekdaysOnly: false,
    fixed: ['09:00', '17:00', '13:00', '21:00'],
  },
};

/** A minute of slack: the check runs every 5 minutes, a refresh made a few seconds early still counts. */
const SLACK_MS = 60_000;
/** How far back a missed fixed refresh is looked for (a long weekend). */
const LOOKBACK_DAYS = 4;

/**
 * Whether `market`'s prices are due under `plan`, given the last request (`null`: never asked). `false` for a market
 * without hours.
 */
export function isRefreshDue(market: Market, plan: RefreshPlan, lastAt: Date | null, now: Date): boolean {
  const hours = MARKET_HOURS[market];
  if (hours === undefined) return false;
  const { date, time } = localClock(now, hours.timeZone);
  const tradingDay = (day: string) => {
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    return !hours.weekdaysOnly || (weekday !== 0 && weekday !== 6);
  };
  if (plan.intervalMinutes !== null) {
    const inSession = tradingDay(date) && time >= hours.open && time < hours.close;
    return (
      inSession && (lastAt === null || now.getTime() - lastAt.getTime() >= plan.intervalMinutes * 60_000 - SLACK_MS)
    );
  }
  const times = hours.fixed.slice(0, plan.refreshesPerDay);
  const latest = Array.from({ length: LOOKBACK_DAYS + 1 }, (_, back) => addDays(date, -back))
    .filter(tradingDay)
    .flatMap((day) => times.map((at) => zonedInstant(day, at, hours.timeZone).getTime()))
    .filter((slot) => slot <= now.getTime())
    .reduce((newest, slot) => Math.max(newest, slot), Number.NEGATIVE_INFINITY);
  return lastAt === null || lastAt.getTime() < latest - SLACK_MS;
}
