// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  assistantBudgetCard,
  assistantInstant,
  assistantSystemPrompt,
  assistantToolDefinitions,
  assistantToolFromName,
  draftImpact,
  findDuplicate,
  maskAssistantAmounts,
  parseAssistantAmount,
  sumReportedCost,
  usedBps,
} from './assistant.ts';

const localDate = (value: string) => value as never;

describe('assistant amounts', () => {
  it('rounds the used share the way the budget page does', () => {
    expect(usedBps(3_200_000n, 3_500_000n)).toBe(9143);
    expect(usedBps(4_500_000n, 4_500_000n)).toBe(10_000);
    expect(usedBps(2_400_000n, 2_000_000n)).toBe(12_000);
    expect(usedBps(0n, 0n)).toBeNull();
  });

  it('accepts whole minor units only and refuses amounts outside the guarded range', () => {
    expect(parseAssistantAmount('45000')).toBe(45_000n);
    expect(() => parseAssistantAmount('45.000')).toThrow(RangeError);
    expect(() => parseAssistantAmount('0')).toThrow(RangeError);
    expect(() => parseAssistantAmount('-45000')).toThrow(RangeError);
    expect(() => parseAssistantAmount('1e6')).toThrow(RangeError);
    expect(() => parseAssistantAmount('1000000000001')).toThrow(RangeError);
  });

  it('places a wall-clock draft in the viewer zone', () => {
    expect(assistantInstant(localDate('2026-10-15'), '12:10', 'Asia/Jakarta').toISOString()).toBe(
      '2026-10-15T05:10:00.000Z',
    );
    expect(assistantInstant(localDate('2026-10-15'), '00:00', 'UTC').toISOString()).toBe('2026-10-15T00:00:00.000Z');
    expect(() => assistantInstant(localDate('2026-10-15'), '24:00', 'UTC')).toThrow(RangeError);
    for (const date of ['not-a-date', '2026-02-30', '2026-1-1', '+002026-10-15']) {
      expect(() => assistantInstant(localDate(date), '12:00', 'UTC')).toThrow(RangeError);
    }
  });
});

describe('assistant evidence', () => {
  it('builds the budget card with the remaining amount and the share used', () => {
    const card = assistantBudgetCard({
      from: localDate('2026-10-01'),
      to: localDate('2026-10-31'),
      currency: 'IDR',
      unbudgetedSpentMinor: 700_000n,
      lines: [
        {
          categoryId: 'c1',
          name: 'Makan & Dapur',
          builtInKey: null,
          group: 'needs',
          limitMinor: 3_500_000n,
          spentMinor: 3_200_000n,
          count: 18,
        },
      ],
    });
    expect(card).toMatchObject({
      kind: 'budget',
      unbudgetedSpentMinor: 700_000n,
      lines: [{ remainingMinor: 300_000n, usedBps: 9143, count: 18 }],
    });
  });

  it('shows the budget share and the account balance after the draft', () => {
    expect(
      draftImpact({
        amountMinor: 45_000n,
        budgetLine: { limitMinor: 3_500_000n, spentMinor: 3_200_000n },
        account: { currency: 'IDR', balanceMinor: 412_000n },
      }),
    ).toEqual({
      budget: { limitMinor: 3_500_000n, spentAfterMinor: 3_245_000n, usedBps: 9271 },
      balance: { currency: 'IDR', afterMinor: 367_000n, thresholdMinor: 500_000n },
    });
  });

  it('has no impact to promise without a budget line or a known account', () => {
    expect(draftImpact({ amountMinor: 45_000n, budgetLine: null, account: null })).toEqual({
      budget: null,
      balance: null,
    });
  });

  it('shows zero utilization for a zero-limit budget and honors the account warning threshold', () => {
    expect(
      draftImpact({
        amountMinor: 10n,
        budgetLine: { limitMinor: 0n, spentMinor: 0n },
        account: { currency: 'USD', balanceMinor: 15n, thresholdMinor: 20n },
      }),
    ).toEqual({
      budget: { limitMinor: 0n, spentAfterMinor: 10n, usedBps: 0 },
      balance: { currency: 'USD', afterMinor: 5n, thresholdMinor: 20n },
    });
  });

  it('treats the same amount within two hours as the same purchase, and nothing else', () => {
    const candidate = (overrides: Partial<Parameters<typeof findDuplicate>[1][number]> = {}) => ({
      transactionId: 't1',
      description: 'Makan siang',
      localDate: localDate('2026-10-15'),
      amountMinor: 110_000n,
      occurredAt: new Date('2026-10-15T00:55:00Z'),
      ...overrides,
    });
    const draft = { amountMinor: 110_000n, occurredAt: new Date('2026-10-15T01:05:00Z') };
    expect(findDuplicate(draft, [candidate()])?.transactionId).toBe('t1');
    // 110.000 vs 111.100 is exactly within 1%.
    expect(findDuplicate({ ...draft, amountMinor: 111_100n }, [candidate()])?.transactionId).toBe('t1');
    expect(findDuplicate({ ...draft, amountMinor: 112_000n }, [candidate()])).toBeNull();
    expect(findDuplicate(draft, [candidate({ occurredAt: new Date('2026-10-15T03:06:00Z') })])).toBeNull();
    expect(findDuplicate({ ...draft, amountMinor: 0n }, [candidate({ amountMinor: 0n })])?.transactionId).toBe('t1');
    expect(findDuplicate(draft, [])).toBeNull();
  });
});

describe('assistant privacy and provider contract', () => {
  it('masks currency amounts in prose but not percentages, dates, or token counts', () => {
    expect(maskAssistantAmounts('Makan & Dapur terpakai Rp3.200.000 dari Rp3.500.000 (91%).')).toBe(
      'Makan & Dapur terpakai Rp•••••• dari Rp•••••• (91%).',
    );
    expect(maskAssistantAmounts('Biaya $0,008 · 1,3k → 290 token · 15 Okt')).toBe(
      'Biaya $•••••• · 1,3k → 290 token · 15 Okt',
    );
    expect(maskAssistantAmounts('Saldo Rp367.000 (di bawah batas Rp500.000)')).toBe(
      'Saldo Rp•••••• (di bawah batas Rp••••••)',
    );
    // A word that merely starts with letters is not an amount prefix.
    expect(maskAssistantAmounts('Rprima 12 unit')).toBe('Rprima 12 unit');
  });

  it('describes the permissions in the prompt and never its own balances', () => {
    const prompt = assistantSystemPrompt({
      locale: 'id',
      timeZone: 'Asia/Jakarta',
      today: localDate('2026-10-15'),
      currency: 'IDR',
      accounts: [{ id: 'a1', name: 'GoPay', currency: 'IDR' }],
      categories: [{ id: 'c1', name: 'Makan & Dapur', group: 'needs' }],
      budget: true,
      drafts: false,
    });
    expect(prompt).toContain('Bahasa Indonesia');
    expect(prompt).toContain('a1 | GoPay (IDR)');
    expect(prompt).toContain('c1 | Makan & Dapur (needs)');
    expect(prompt).toContain('Draft creation is not allowed');
    expect(prompt).not.toMatch(/saldo|balance/i);
  });

  it('does not expose ledger tools or invent accounts for an English no-data conversation', () => {
    const prompt = assistantSystemPrompt({
      locale: 'en',
      timeZone: 'UTC',
      today: localDate('2026-10-15'),
      currency: 'USD',
      accounts: [],
      categories: [],
      budget: false,
      drafts: true,
    });
    expect(prompt).toContain('Answer in English');
    expect(prompt).toContain('Accounts you may use:\n(none)');
    expect(prompt).toContain('Categories you may use:\n(none)');
    expect(prompt).toContain('ledger tools are unavailable');
    expect(prompt).toContain('The user allows transaction drafts.');
  });

  it('offers the bounded tool surface with provider JSON schemas', () => {
    const definitions = assistantToolDefinitions();
    expect(definitions.map((tool) => tool.name)).toEqual([
      'ringkasan_anggaran',
      'pengeluaran',
      'transaksi_terbesar',
      'saldo_rekening',
      'draf_transaksi',
    ]);
    expect(definitions.at(-1)?.parameters).toMatchObject({ type: 'object' });
    expect(assistantToolFromName('draf_transaksi')).toBe('draf_transaksi');
    expect(assistantToolFromName('hapus_transaksi')).toBeNull();
  });

  it('keeps a reported cost exact and never guesses one', () => {
    expect(sumReportedCost(['0.0002', '0.001148'])).toBe('0.001348');
    expect(sumReportedCost(['0.1'])).toBe('0.1');
    expect(sumReportedCost(['0.0002', null])).toBeNull();
    expect(sumReportedCost([])).toBeNull();
  });
});
