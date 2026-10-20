// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import {
  changePeriodStart,
  dismissBudgetAlert,
  moveBudgetLeftover,
  previewPeriodStart,
  removeBudgetLine,
  restoreBudgetAlert,
  saveBudgetVersion,
  setBudgetLine,
  undoBudgetMove,
} from './budget-write.ts';

const PERIOD_ID = '0192a6c0-0000-7000-8000-000000000001';
const CATEGORY_ID = '0192a6c0-0000-7000-8000-000000000002';
const OTHER_ID = '0192a6c0-0000-7000-8000-000000000003';
const MOVE_ID = '0192a6c0-0000-7000-8000-000000000004';

const fake = vi.hoisted(() => ({
  ledgerError: (code: string) => Object.assign(new Error(code), { code }),
  budgets: {
    saveVersion: vi.fn(() => Promise.resolve({ effectiveFrom: '2026-10' })),
    setLine: vi.fn(() => Promise.resolve({ effectiveFrom: '2026-10' })),
    removeLine: vi.fn(() => Promise.resolve({ effectiveFrom: '2026-10' })),
    moveLeftover: vi.fn(() => Promise.resolve({ moveId: 'move', deltas: [] })),
    undoMove: vi.fn(() => Promise.resolve({ removed: 2 })),
    dismissAlert: vi.fn(() => Promise.resolve()),
    restoreAlert: vi.fn(() => Promise.resolve()),
  },
  periods: {
    previewStartDay: vi.fn(() => Promise.resolve({ apply: 'next_period' })),
    changeStartDay: vi.fn(() => Promise.resolve({ apply: 'recalculate' })),
  },
}));

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () =>
    Promise.resolve({
      budgets: fake.budgets,
      periods: fake.periods,
      now: () => new Date('2026-10-15T09:42:00Z'),
    }),
}));

const USER_ID = fakeSession().user.id;
const signedIn = () => requestContext(fakeSession());
const signedOut = () => requestContext(null);
const line = { periodId: PERIOD_ID, categoryId: CATEGORY_ID };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('budget writes', () => {
  it('saves a version, dropping absent options instead of passing undefined', async () => {
    expect(
      await call(saveBudgetVersion, {
        context: signedIn(),
        data: {
          effectiveFrom: '2026-10',
          lines: [
            { categoryId: CATEGORY_ID, limitMinor: 1_500_000n },
            { categoryId: OTHER_ID, limitMinor: 0n, rollover: true, isFixed: false, alertPct: 50 },
          ],
        },
      }),
    ).toEqual({ ok: true, value: { effectiveFrom: '2026-10' } });
    expect(fake.budgets.saveVersion).toHaveBeenLastCalledWith(USER_ID, {
      effectiveFrom: '2026-10',
      lines: [
        { categoryId: CATEGORY_ID, limitMinor: 1_500_000n },
        { categoryId: OTHER_ID, limitMinor: 0n, rollover: true, isFixed: false, alertPct: 50 },
      ],
    });
    await call(saveBudgetVersion, {
      context: signedIn(),
      data: { effectiveFrom: '2026-11', expectedIncomeMinor: null, lines: [] },
    });
    expect(fake.budgets.saveVersion).toHaveBeenLastCalledWith(USER_ID, {
      effectiveFrom: '2026-11',
      expectedIncomeMinor: null,
      lines: [],
    });
    await call(saveBudgetVersion, {
      context: signedIn(),
      data: { effectiveFrom: '2026-12', expectedIncomeMinor: 25_800_000n, lines: [] },
    });
    expect(fake.budgets.saveVersion).toHaveBeenLastCalledWith(USER_ID, {
      effectiveFrom: '2026-12',
      expectedIncomeMinor: 25_800_000n,
      lines: [],
    });
  });

  it('sets one line, passing only the fields given', async () => {
    expect(await call(setBudgetLine, { context: signedIn(), data: { ...line, limitMinor: 900_000n } })).toEqual({
      ok: true,
      value: { effectiveFrom: '2026-10' },
    });
    expect(fake.budgets.setLine).toHaveBeenLastCalledWith(USER_ID, PERIOD_ID, {
      categoryId: CATEGORY_ID,
      limitMinor: 900_000n,
    });
    await call(setBudgetLine, {
      context: signedIn(),
      data: { ...line, rollover: false, isFixed: true, alertPct: 100 },
    });
    expect(fake.budgets.setLine).toHaveBeenLastCalledWith(USER_ID, PERIOD_ID, {
      categoryId: CATEGORY_ID,
      rollover: false,
      isFixed: true,
      alertPct: 100,
    });
  });

  it('removes a line', async () => {
    expect(await call(removeBudgetLine, { context: signedIn(), data: line })).toEqual({
      ok: true,
      value: { effectiveFrom: '2026-10' },
    });
    expect(fake.budgets.removeLine).toHaveBeenCalledWith(USER_ID, PERIOD_ID, CATEGORY_ID);
  });

  it('moves leftover and undoes the move', async () => {
    const sources = [{ categoryId: OTHER_ID, amountMinor: 150_000n }];
    expect(
      await call(moveBudgetLeftover, {
        context: signedIn(),
        data: { periodId: PERIOD_ID, targetCategoryId: CATEGORY_ID, sources },
      }),
    ).toEqual({ ok: true, value: { moveId: 'move', deltas: [] } });
    expect(fake.budgets.moveLeftover).toHaveBeenCalledWith(USER_ID, PERIOD_ID, {
      targetCategoryId: CATEGORY_ID,
      sources,
    });
    expect(await call(undoBudgetMove, { context: signedIn(), data: { moveId: MOVE_ID } })).toEqual({
      ok: true,
      value: { removed: 2 },
    });
    expect(fake.budgets.undoMove).toHaveBeenCalledWith(USER_ID, MOVE_ID);
  });

  it('dismisses and restores a warning', async () => {
    expect(await call(dismissBudgetAlert, { context: signedIn(), data: line })).toEqual({ ok: true, value: null });
    expect(fake.budgets.dismissAlert).toHaveBeenCalledWith(USER_ID, PERIOD_ID, CATEGORY_ID);
    expect(await call(restoreBudgetAlert, { context: signedIn(), data: line })).toEqual({ ok: true, value: null });
    expect(fake.budgets.restoreAlert).toHaveBeenCalledWith(USER_ID, PERIOD_ID, CATEGORY_ID);
  });

  it('previews and changes the start day, dropping an absent mode', async () => {
    expect(await call(previewPeriodStart, { context: signedIn(), data: { day: 25, apply: 'next_period' } })).toEqual({
      ok: true,
      value: { apply: 'next_period' },
    });
    expect(fake.periods.previewStartDay).toHaveBeenCalledWith(USER_ID, { day: 25, apply: 'next_period' });
    expect(
      await call(changePeriodStart, {
        context: signedIn(),
        data: { day: 1, apply: 'recalculate', mode: 'follow_payday' },
      }),
    ).toEqual({ ok: true, value: { apply: 'recalculate' } });
    expect(fake.periods.changeStartDay).toHaveBeenCalledWith(USER_ID, {
      day: 1,
      apply: 'recalculate',
      mode: 'follow_payday',
    });
  });

  it('turns ledger errors into expected results', async () => {
    fake.budgets.saveVersion.mockRejectedValueOnce(fake.ledgerError('PERIOD_CLOSED'));
    expect(
      await call(saveBudgetVersion, { context: signedIn(), data: { effectiveFrom: '2026-09', lines: [] } }),
    ).toEqual({ ok: false, code: 'PERIOD_CLOSED' });
    fake.budgets.setLine.mockRejectedValueOnce(fake.ledgerError('INVALID_BUDGET'));
    expect(await call(setBudgetLine, { context: signedIn(), data: line })).toEqual({
      ok: false,
      code: 'INVALID_BUDGET',
    });
    fake.budgets.removeLine.mockRejectedValueOnce(fake.ledgerError('NOT_FOUND'));
    expect(await call(removeBudgetLine, { context: signedIn(), data: line })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    fake.budgets.moveLeftover.mockRejectedValueOnce(fake.ledgerError('INVALID_BUDGET'));
    expect(
      await call(moveBudgetLeftover, {
        context: signedIn(),
        data: {
          periodId: PERIOD_ID,
          targetCategoryId: CATEGORY_ID,
          sources: [{ categoryId: OTHER_ID, amountMinor: 1n }],
        },
      }),
    ).toEqual({ ok: false, code: 'INVALID_BUDGET' });
    fake.budgets.undoMove.mockRejectedValueOnce(fake.ledgerError('NOT_FOUND'));
    expect(await call(undoBudgetMove, { context: signedIn(), data: { moveId: MOVE_ID } })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    fake.budgets.dismissAlert.mockRejectedValueOnce(fake.ledgerError('PERIOD_CLOSED'));
    expect(await call(dismissBudgetAlert, { context: signedIn(), data: line })).toEqual({
      ok: false,
      code: 'PERIOD_CLOSED',
    });
    fake.budgets.restoreAlert.mockRejectedValueOnce(fake.ledgerError('NOT_FOUND'));
    expect(await call(restoreBudgetAlert, { context: signedIn(), data: line })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    fake.periods.previewStartDay.mockRejectedValueOnce(fake.ledgerError('INVALID_PERIOD'));
    expect(await call(previewPeriodStart, { context: signedIn(), data: { day: 1, apply: 'next_period' } })).toEqual({
      ok: false,
      code: 'INVALID_PERIOD',
    });
    fake.periods.changeStartDay.mockRejectedValueOnce(fake.ledgerError('INVALID_PERIOD'));
    expect(await call(changePeriodStart, { context: signedIn(), data: { day: 1, apply: 'recalculate' } })).toEqual({
      ok: false,
      code: 'INVALID_PERIOD',
    });
  });

  it('refuses signed-out requests', async () => {
    const day = { day: 25, apply: 'next_period' } as const;
    const refusals = [
      await call(saveBudgetVersion, { context: signedOut(), data: { effectiveFrom: '2026-10', lines: [] } }),
      await call(setBudgetLine, { context: signedOut(), data: line }),
      await call(removeBudgetLine, { context: signedOut(), data: line }),
      await call(moveBudgetLeftover, {
        context: signedOut(),
        data: {
          periodId: PERIOD_ID,
          targetCategoryId: CATEGORY_ID,
          sources: [{ categoryId: OTHER_ID, amountMinor: 1n }],
        },
      }),
      await call(undoBudgetMove, { context: signedOut(), data: { moveId: MOVE_ID } }),
      await call(dismissBudgetAlert, { context: signedOut(), data: line }),
      await call(restoreBudgetAlert, { context: signedOut(), data: line }),
      await call(previewPeriodStart, { context: signedOut(), data: day }),
      await call(changePeriodStart, { context: signedOut(), data: day }),
    ];
    expect(refusals).toEqual(Array(9).fill({ ok: false, code: 'UNAUTHENTICATED' }));
    for (const method of [...Object.values(fake.budgets), ...Object.values(fake.periods)]) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it('validates budget versions', () => {
    const save = validatorOf(saveBudgetVersion);
    const valid = { effectiveFrom: '2026-10', lines: [{ categoryId: CATEGORY_ID, limitMinor: 0n }] };
    expect(save.safeParse(valid)).toEqual({ success: true, data: valid });
    for (const effectiveFrom of ['2026-13', '2026-00', '2026-1', '26-10', '2026-10-01']) {
      expect(save.safeParse({ ...valid, effectiveFrom }).success).toBe(false);
    }
    expect(save.safeParse({ ...valid, expectedIncomeMinor: null }).success).toBe(true);
    expect(save.safeParse({ ...valid, expectedIncomeMinor: -1n }).success).toBe(false);
    expect(save.safeParse({ ...valid, expectedIncomeMinor: 1000 }).success).toBe(false);
    expect(save.safeParse({ ...valid, lines: [{ categoryId: CATEGORY_ID, limitMinor: -1n }] }).success).toBe(false);
    expect(save.safeParse({ ...valid, lines: [{ categoryId: CATEGORY_ID, limitMinor: 1000 }] }).success).toBe(false);
    expect(save.safeParse({ ...valid, lines: [{ categoryId: 'nope', limitMinor: 0n }] }).success).toBe(false);
    for (const alertPct of [50, 80, 85, 100]) {
      expect(save.safeParse({ ...valid, lines: [{ categoryId: CATEGORY_ID, limitMinor: 0n, alertPct }] }).success).toBe(
        true,
      );
    }
    expect(
      save.safeParse({ ...valid, lines: [{ categoryId: CATEGORY_ID, limitMinor: 0n, alertPct: 90 }] }).success,
    ).toBe(false);
    const many = Array(201).fill(valid.lines[0]);
    expect(save.safeParse({ ...valid, lines: many.slice(1) }).success).toBe(true);
    expect(save.safeParse({ ...valid, lines: many }).success).toBe(false);
  });

  it('validates line edits and moves', () => {
    const set = validatorOf(setBudgetLine);
    expect(set.safeParse(line).success).toBe(true);
    expect(set.safeParse({ ...line, limitMinor: 0n, alertPct: 85 }).success).toBe(true);
    expect(set.safeParse({ ...line, limitMinor: -5n }).success).toBe(false);
    expect(set.safeParse({ ...line, alertPct: 75 }).success).toBe(false);
    expect(set.safeParse({ ...line, rollover: 'yes' }).success).toBe(false);
    expect(set.safeParse({ periodId: PERIOD_ID }).success).toBe(false);
    for (const fn of [removeBudgetLine, dismissBudgetAlert, restoreBudgetAlert]) {
      expect(validatorOf(fn).safeParse(line).success).toBe(true);
      expect(validatorOf(fn).safeParse({ ...line, periodId: 'nope' }).success).toBe(false);
    }
    const move = validatorOf(moveBudgetLeftover);
    const valid = {
      periodId: PERIOD_ID,
      targetCategoryId: CATEGORY_ID,
      sources: [{ categoryId: OTHER_ID, amountMinor: 1n }],
    };
    expect(move.safeParse(valid).success).toBe(true);
    expect(move.safeParse({ ...valid, sources: [] }).success).toBe(false);
    expect(move.safeParse({ ...valid, sources: [{ categoryId: OTHER_ID, amountMinor: 0n }] }).success).toBe(false);
    expect(move.safeParse({ ...valid, sources: [{ categoryId: OTHER_ID, amountMinor: 1 }] }).success).toBe(false);
    expect(move.safeParse({ ...valid, sources: Array(201).fill(valid.sources[0]) }).success).toBe(false);
    expect(validatorOf(undoBudgetMove).safeParse({ moveId: MOVE_ID }).success).toBe(true);
    expect(validatorOf(undoBudgetMove).safeParse({ moveId: 'nope' }).success).toBe(false);
  });

  it('validates start-day changes', () => {
    for (const fn of [previewPeriodStart, changePeriodStart]) {
      const change = validatorOf(fn);
      expect(change.safeParse({ day: 1, apply: 'next_period' })).toEqual({
        success: true,
        data: { day: 1, apply: 'next_period' },
      });
      expect(change.safeParse({ day: 28, apply: 'recalculate', mode: 'fixed_day' }).success).toBe(true);
      for (const day of [0, 29, 12.5, '5']) {
        expect(change.safeParse({ day, apply: 'next_period' }).success).toBe(false);
      }
      expect(change.safeParse({ day: 5, apply: 'now' }).success).toBe(false);
      expect(change.safeParse({ day: 5, apply: 'next_period', mode: 'weekly' }).success).toBe(false);
    }
  });
});
