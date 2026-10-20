// SPDX-License-Identifier: AGPL-3.0-only
import type { LocalDate } from '@wf/domain/period';
import { setLocale } from '@wf/i18n/runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { periodPreview, QUICK_ACCOUNT_CHIPS, quickAccountChips, quickAccounts } from './onboarding.ts';

beforeEach(async () => {
  await setLocale('id', { reload: false });
});

const day = (value: string) => value as LocalDate;

describe('quick accounts', () => {
  it('offers BCA, Bank Jago, and GoPay first, then the design chips once those are taken', () => {
    expect(QUICK_ACCOUNT_CHIPS).toBe(3);
    expect(quickAccountChips([]).map((chip) => chip.displayName)).toEqual(['BCA', 'Bank Jago', 'GoPay']);
    // Case and spaces do not matter; the row's provider name counts.
    expect(quickAccountChips([' bca ', 'BANK JAGO', 'GoPay']).map((chip) => chip.displayName)).toEqual([
      'Mandiri',
      'OVO',
      'Tunai',
    ]);
    expect(quickAccounts().find((chip) => chip.type === 'cash')).toEqual({
      type: 'cash',
      providerName: 'Tunai',
      displayName: 'Tunai',
      color: 'cyan',
    });
  });

  it('names cash in the interface language', async () => {
    await setLocale('en', { reload: false });
    expect(quickAccounts().find((chip) => chip.type === 'cash')?.displayName).toBe('Cash');
  });
});

describe('periodPreview', () => {
  it('names the period after the month it ends in, with its range', () => {
    expect(periodPreview({ start: day('2026-10-01'), end: day('2026-10-31') }, 'id')).toEqual({
      month: 'Okt',
      year: '2026',
      range: '1–31 Okt',
    });
    expect(periodPreview({ start: day('2026-09-25'), end: day('2026-10-24') }, 'en')).toEqual({
      month: 'Oct',
      year: '2026',
      range: 'Sep 25 – Oct 24',
    });
  });
});
