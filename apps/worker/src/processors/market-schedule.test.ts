// SPDX-License-Identifier: AGPL-3.0-only
import { refreshPlan, type ByokProvider, type Market, type RefreshPlan } from '@wf/domain/market';
import { describe, expect, it } from 'vitest';
import { isRefreshDue, MARKET_HOURS } from './market-schedule.ts';

const plan = (provider: ByokProvider, market: Market, symbols: number) =>
  refreshPlan(provider, market, symbols) as RefreshPlan;

describe('isRefreshDue', () => {
  // Tiingo, 15 US symbols: every 15 minutes during the New York session.
  const tiingo = plan('tiingo', 'us_equity', 15);

  it('refreshes on the interval during the US session only, on weekdays', () => {
    expect(tiingo.intervalMinutes).toBe(15);
    // Wednesday 14 Oct, 10.00 EDT.
    const open = new Date('2026-10-14T14:00:00Z');
    expect(isRefreshDue('us_equity', tiingo, null, open)).toBe(true);
    expect(isRefreshDue('us_equity', tiingo, new Date('2026-10-14T13:46:00Z'), open)).toBe(true);
    expect(isRefreshDue('us_equity', tiingo, new Date('2026-10-14T13:50:00Z'), open)).toBe(false);
    // 16.30 EDT: closed; Saturday: closed.
    expect(isRefreshDue('us_equity', tiingo, null, new Date('2026-10-14T20:30:00Z'))).toBe(false);
    expect(isRefreshDue('us_equity', tiingo, null, new Date('2026-10-17T15:00:00Z'))).toBe(false);
  });

  it('places EODHD’s four daily IDX refreshes at the close and 10.00/12.00/14.30 WIB, catching up a missed one', () => {
    const eodhd = plan('eodhd', 'idx_equity', 4);
    expect(eodhd).toMatchObject({ intervalMinutes: null, refreshesPerDay: 4 });
    // Thursday 15 Oct, 12.05 WIB: the 12.00 refresh is due unless made after it.
    const noon = new Date('2026-10-15T05:05:00Z');
    expect(isRefreshDue('idx_equity', eodhd, new Date('2026-10-15T03:00:00Z'), noon)).toBe(true);
    expect(isRefreshDue('idx_equity', eodhd, new Date('2026-10-15T05:00:30Z'), noon)).toBe(false);
    // 08.00 WIB: nothing yet today, so yesterday's close is the latest slot.
    const morning = new Date('2026-10-15T01:00:00Z');
    expect(isRefreshDue('idx_equity', eodhd, new Date('2026-10-14T09:16:00Z'), morning)).toBe(false);
    expect(isRefreshDue('idx_equity', eodhd, new Date('2026-10-14T07:31:00Z'), morning)).toBe(true);
    // Sunday: Friday's close is the latest.
    const sunday = new Date('2026-10-18T03:00:00Z');
    expect(isRefreshDue('idx_equity', eodhd, new Date('2026-10-16T09:20:00Z'), sunday)).toBe(false);
    expect(isRefreshDue('idx_equity', eodhd, new Date('2026-10-16T08:00:00Z'), sunday)).toBe(true);
  });

  it('refreshes end-of-day sources once after the close', () => {
    const massive = plan('massive', 'us_equity', 15);
    expect(massive).toMatchObject({ intervalMinutes: null, refreshesPerDay: 1 });
    // Thursday 15 Oct 16.20 EDT, last asked Wednesday evening.
    expect(isRefreshDue('us_equity', massive, new Date('2026-10-14T20:20:00Z'), new Date('2026-10-15T20:20:00Z'))).toBe(
      true,
    );
    expect(isRefreshDue('us_equity', massive, new Date('2026-10-15T20:16:00Z'), new Date('2026-10-15T20:20:00Z'))).toBe(
      false,
    );
  });

  it('refreshes crypto and gold any day, by interval or at fixed times', () => {
    const coingecko = plan('coingecko', 'crypto', 3);
    expect(coingecko.intervalMinutes).toBe(10);
    const sunday = new Date('2026-10-18T03:00:00Z');
    expect(isRefreshDue('crypto', coingecko, new Date('2026-10-18T02:49:00Z'), sunday)).toBe(true);
    const goldapi = plan('goldapi', 'gold_spot', 1);
    expect(goldapi).toMatchObject({ intervalMinutes: null, refreshesPerDay: 2 });
    // 18.00 WIB: the 17.00 slot.
    expect(isRefreshDue('gold_spot', goldapi, new Date('2026-10-18T02:05:00Z'), new Date('2026-10-18T11:00:00Z'))).toBe(
      true,
    );
    expect(isRefreshDue('gold_spot', goldapi, new Date('2026-10-18T10:01:00Z'), new Date('2026-10-18T11:00:00Z'))).toBe(
      false,
    );
  });

  it('never refreshes markets without hours, and asks a never-asked key when no slot is near', () => {
    expect(isRefreshDue('fx', tiingo, null, new Date())).toBe(false);
    expect(MARKET_HOURS.mutual_fund).toBeUndefined();
    // A plan without fixed refreshes has no slot: only a key never asked is due.
    const none = { intervalMinutes: null, refreshesPerDay: 0, callsPerRefresh: 1, callsPerDay: 0, callsPerMonth: 0 };
    expect(isRefreshDue('idx_equity', none, null, new Date('2026-10-18T03:00:00Z'))).toBe(true);
    expect(isRefreshDue('idx_equity', none, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-18T03:00:00Z'))).toBe(
      false,
    );
  });
});
