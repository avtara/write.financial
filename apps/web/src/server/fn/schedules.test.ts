// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import * as fns from './schedules.ts';

const ID = '0192a6c0-0000-7000-8000-000000000001';
const OTHER = '0192a6c0-0000-7000-8000-000000000002';

const fake = vi.hoisted(() => ({
  ledgerError: (code: string) => Object.assign(new Error(code), { code }),
  schedules: {
    listRecurrences: vi.fn(() => Promise.resolve('recurrences')),
    createRecurrence: vi.fn(() => Promise.resolve('recurrence')),
    updateRecurrence: vi.fn(() => Promise.resolve('recurrence')),
    stopRecurrence: vi.fn(() => Promise.resolve({ deletedOccurrences: 3 })),
    undoStopRecurrence: vi.fn(() => Promise.resolve('recurrence')),
    listSubscriptions: vi.fn(() => Promise.resolve('overview')),
    getSubscription: vi.fn(() => Promise.resolve('subscription')),
    createSubscription: vi.fn(() => Promise.resolve('subscription')),
    updateSubscription: vi.fn(() => Promise.resolve('subscription')),
    deleteSubscription: vi.fn(() => Promise.resolve({ deletedOccurrences: 2 })),
    changeAccount: vi.fn(() => Promise.resolve({ effectiveFrom: '2026-11-18', insufficient: null })),
    pause: vi.fn(() => Promise.resolve('subscription')),
    cancel: vi.fn(() => Promise.resolve('subscription')),
    reactivate: vi.fn(() => Promise.resolve('subscription')),
    rateUsage: vi.fn(() => Promise.resolve('subscription')),
    billingHistory: vi.fn(() => Promise.resolve('history')),
    listDetected: vi.fn(() => Promise.resolve('detected')),
    addDetected: vi.fn(() => Promise.resolve({ subscriptionIds: [] })),
    dismissDetected: vi.fn(() => Promise.resolve({ dismissed: 1 })),
    listScheduled: vi.fn(() => Promise.resolve([])),
  },
}));

// vi.mock factories run before imports; they load the shared helper themselves.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () => Promise.resolve({ schedules: fake.schedules, now: () => new Date('2026-10-15T09:42:00Z') }),
}));

const USER_ID = fakeSession().user.id;
const signedIn = () => requestContext(fakeSession());
const signedOut = () => requestContext(null);
/** The input as the validator hands it to the handler. */
const parse = (fn: unknown, data: unknown): unknown => validatorOf(fn).parse(data);

const RULE = {
  template: { type: 'expense', accountId: ID, amountMinor: 3_500_000n, categoryId: OTHER, description: 'Kos' },
  freq: 'monthly',
  startOn: '2026-11-01',
  monthDay: 1,
  end: { type: 'never' },
  remindOffsetDays: 1,
};
const NETFLIX = {
  name: 'Netflix',
  plan: 'Premium',
  priceMinor: 186_000n,
  currency: 'IDR',
  cycle: 'monthly',
  nextBillingDate: '2026-10-18',
  payFromAccountId: ID,
  categoryId: null,
  startedOn: '2024-03-18',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('schedule server functions', () => {
  it('passes each request to its repository method with the session user', async () => {
    const cases: [unknown, unknown, keyof typeof fake.schedules, unknown[]][] = [
      [fns.listRecurrences, { status: 'active' }, 'listRecurrences', [{ status: 'active' }]],
      [fns.listRecurrences, {}, 'listRecurrences', [{}]],
      [fns.createRecurrence, RULE, 'createRecurrence', [RULE]],
      [fns.updateRecurrence, { id: ID, ...RULE }, 'updateRecurrence', [ID, RULE]],
      [fns.stopRecurrence, { id: ID }, 'stopRecurrence', [ID]],
      [fns.undoStopRecurrence, { id: ID }, 'undoStopRecurrence', [ID]],
      [fns.listSubscriptions, {}, 'listSubscriptions', [{}]],
      [fns.getSubscription, { id: ID }, 'getSubscription', [ID]],
      [fns.createSubscription, NETFLIX, 'createSubscription', [NETFLIX]],
      [
        fns.updateSubscription,
        { id: ID, patch: { priceMinor: 199_000n } },
        'updateSubscription',
        [ID, { priceMinor: 199_000n }],
      ],
      [fns.deleteSubscription, { id: ID }, 'deleteSubscription', [ID]],
      [fns.changeSubscriptionAccount, { id: ID, accountId: OTHER }, 'changeAccount', [ID, OTHER]],
      [
        fns.pauseSubscription,
        { id: ID, length: { months: 1 }, remindDaysBefore: 3 },
        'pause',
        [ID, { months: 1 }, { remindDaysBefore: 3 }],
      ],
      [fns.cancelSubscription, { id: ID, mode: 'after_next_bill' }, 'cancel', [ID, 'after_next_bill']],
      [fns.reactivateSubscription, { id: ID }, 'reactivate', [ID]],
      [fns.rateSubscriptionUsage, { id: ID, rating: 'rarely' }, 'rateUsage', [ID, 'rarely']],
      [fns.getSubscriptionBilling, { id: ID }, 'billingHistory', [ID]],
      [fns.listDetectedSubscriptions, undefined, 'listDetected', []],
      [fns.addDetectedSubscriptions, { ids: [ID] }, 'addDetected', [[ID]]],
      [fns.dismissDetectedSubscriptions, { ids: [ID, OTHER] }, 'dismissDetected', [[ID, OTHER]]],
      [
        fns.listScheduled,
        { from: '2026-10-01', to: '2026-10-31' },
        'listScheduled',
        [{ from: '2026-10-01', to: '2026-10-31' }],
      ],
    ];
    for (const [fn, data, method, args] of cases) {
      const result = await call<{ ok: boolean }>(fn, { context: signedIn(), data });
      expect(result, method).toEqual({ ok: true, value: await fake.schedules[method]() });
      expect(fake.schedules[method], method).toHaveBeenCalledWith(USER_ID, ...args);
    }
  });

  it('never passes undefined properties, also inside a recurrence template', async () => {
    const parsed = parse(fns.createRecurrence, {
      ...RULE,
      template: { ...RULE.template, merchant: undefined, tags: undefined },
      interval: undefined,
    });
    await call(fns.createRecurrence, { context: signedIn(), data: parsed });
    // toStrictEqual fails on a key that is present with the value `undefined`.
    expect(fake.schedules.createRecurrence.mock.lastCall).toStrictEqual([USER_ID, RULE]);
    await call(fns.updateSubscription, {
      context: signedIn(),
      data: { id: ID, patch: { plan: undefined, icon: null } },
    });
    expect(fake.schedules.updateSubscription.mock.lastCall).toStrictEqual([USER_ID, ID, { icon: null }]);
  });

  it('turns ledger errors into expected results', async () => {
    fake.schedules.createSubscription.mockRejectedValueOnce(fake.ledgerError('INVALID_SUBSCRIPTION'));
    expect(await call(fns.createSubscription, { context: signedIn(), data: NETFLIX })).toEqual({
      ok: false,
      code: 'INVALID_SUBSCRIPTION',
    });
    fake.schedules.getSubscription.mockRejectedValueOnce(fake.ledgerError('NOT_FOUND'));
    expect(await call(fns.getSubscription, { context: signedIn(), data: { id: ID } })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('refuses signed-out requests before any repository call', async () => {
    const all = Object.values(fns);
    expect(all).toHaveLength(20);
    for (const fn of all) {
      expect(await call(fn, { context: signedOut(), data: {} })).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    }
    expect(Object.values(fake.schedules).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it('validates recurrences', () => {
    const create = validatorOf(fns.createRecurrence);
    expect(create.safeParse(RULE).success).toBe(true);
    const transfer = {
      type: 'transfer',
      fromAccountId: ID,
      toAccountId: OTHER,
      sentMinor: 500_000n,
      receivedMinor: 500_000n,
      fee: { minor: 2_500n, categoryId: OTHER },
      allocations: [{ goalId: OTHER, amountMinor: 250_000n }],
    };
    expect(
      create.safeParse({ ...RULE, template: transfer, freq: 'weekly', weekday: 5, end: { type: 'after', count: 12 } })
        .success,
    ).toBe(true);
    expect(create.safeParse({ ...RULE, weekday: 8 }).success).toBe(false);
    expect(create.safeParse({ ...RULE, interval: 0 }).success).toBe(false);
    expect(create.safeParse({ ...RULE, end: { type: 'after', count: 0 } }).success).toBe(false);
    expect(create.safeParse({ ...RULE, remindOffsetDays: 31 }).success).toBe(false);
    expect(create.safeParse({ ...RULE, template: { ...RULE.template, amountMinor: 0n } }).success).toBe(false);
    expect(create.safeParse({ ...RULE, template: { ...RULE.template, amountMinor: 3500000 } }).success).toBe(false);
    expect(create.safeParse({ ...RULE, startOn: '2026-11-31' }).success).toBe(false);
    expect(validatorOf(fns.updateRecurrence).safeParse(RULE).success).toBe(false);
    expect(validatorOf(fns.listRecurrences).safeParse({ status: 'paused' }).success).toBe(false);
  });

  it('validates subscriptions and their actions', () => {
    const create = validatorOf(fns.createSubscription);
    expect(create.safeParse({ ...NETFLIX, trial: { days: 14 }, remindDaysBefore: null }).success).toBe(true);
    expect(create.safeParse({ ...NETFLIX, trial: { months: 1 } }).success).toBe(true);
    expect(create.safeParse({ ...NETFLIX, trial: { until: '2026-11-01' } }).success).toBe(true);
    expect(create.safeParse({ ...NETFLIX, trial: { weeks: 2 } }).success).toBe(false);
    expect(create.safeParse({ ...NETFLIX, name: '  ' }).success).toBe(false);
    expect(create.safeParse({ ...NETFLIX, name: 'x'.repeat(41) }).success).toBe(false);
    expect(create.safeParse({ ...NETFLIX, currency: 'idr' }).success).toBe(false);
    expect(create.safeParse({ ...NETFLIX, cycle: 'daily' }).success).toBe(false);
    expect(validatorOf(fns.updateSubscription).safeParse({ id: ID, patch: {} }).success).toBe(true);
    expect(validatorOf(fns.updateSubscription).safeParse({ id: ID, patch: { priceMinor: -1n } }).success).toBe(false);
    const pause = validatorOf(fns.pauseSubscription);
    expect(pause.safeParse({ id: ID, length: { until: '2026-12-01' }, remindDaysBefore: null }).success).toBe(true);
    expect(pause.safeParse({ id: ID, length: { months: 3 }, remindDaysBefore: 3 }).success).toBe(false);
    expect(validatorOf(fns.cancelSubscription).safeParse({ id: ID, mode: 'later' }).success).toBe(false);
    expect(validatorOf(fns.rateSubscriptionUsage).safeParse({ id: ID, rating: 'never' }).success).toBe(false);
    expect(validatorOf(fns.addDetectedSubscriptions).safeParse({ ids: [] }).success).toBe(false);
    expect(validatorOf(fns.listSubscriptions).safeParse({ status: 'paused' }).success).toBe(true);
    expect(validatorOf(fns.listScheduled).safeParse({ from: '2026-10-01' }).success).toBe(false);
  });
});
