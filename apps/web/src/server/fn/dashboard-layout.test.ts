// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, fakeSession } from '../../../test/fixtures.ts';
import { call, requestContext, validatorOf } from '../../../test/server-fn.ts';
import { DEFAULT_DASHBOARD_LAYOUT, type DashboardLayout } from '../../lib/dashboard-layout.ts';
import type { Result } from '../access.ts';
import { getDashboardLayout, saveDashboardLayout } from './dashboard-layout.ts';

const USER_ID = fakeSession().user.id;

const fake = vi.hoisted(() => ({
  preferences: {
    get: vi.fn(),
    update: vi.fn(),
  },
}));

// `vi.mock` factories run before the file's static imports, so the helper is imported inside the factory.
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () => Promise.resolve({ now: () => NOW, preferences: fake.preferences }),
}));

const signedIn = () => requestContext(fakeSession());

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getDashboardLayout', () => {
  it("reads the signed-in user's stored layout, completed, or the defaults before the first save", async () => {
    fake.preferences.get.mockResolvedValueOnce({ dashboardLayout: {} });
    expect(await call(getDashboardLayout, { context: signedIn() })).toEqual({
      ok: true,
      value: DEFAULT_DASHBOARD_LAYOUT,
    });
    expect(fake.preferences.get).toHaveBeenCalledWith(USER_ID);

    fake.preferences.get.mockResolvedValueOnce({
      dashboardLayout: { cards: [{ id: 'budget', visible: false, width: 'full' }] },
    });
    const result = await call<Result<DashboardLayout>>(getDashboardLayout, { context: signedIn() });
    expect(result.ok && result.value.cards.find((card) => card.id === 'budget')).toEqual({
      id: 'budget',
      visible: false,
      width: 'full',
    });
    expect(result.ok && result.value.cards).toHaveLength(DEFAULT_DASHBOARD_LAYOUT.cards.length);
  });

  it('refuses a request without a session', async () => {
    expect(await call(getDashboardLayout, { context: requestContext(null) })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
    expect(fake.preferences.get).not.toHaveBeenCalled();
  });
});

describe('saveDashboardLayout', () => {
  it('stores the completed layout on the signed-in user and returns what is stored', async () => {
    fake.preferences.update.mockImplementation((_userId: string, patch: { dashboardLayout: unknown }) =>
      Promise.resolve({ dashboardLayout: patch.dashboardLayout }),
    );
    const data = { cards: [{ id: 'goals', visible: true, width: 'twoThirds' }] };
    const result = await call<Result<DashboardLayout>>(saveDashboardLayout, { context: signedIn(), data });
    expect(result.ok && result.value.cards.find((card) => card.id === 'goals')).toEqual({
      id: 'goals',
      visible: true,
      width: 'twoThirds',
    });
    const [userId, patch] = fake.preferences.update.mock.calls[0] as [string, { dashboardLayout: DashboardLayout }];
    expect(userId).toBe(USER_ID);
    // Every card is stored, so a later release's defaults never reorder what the user arranged.
    expect(patch.dashboardLayout.cards).toHaveLength(DEFAULT_DASHBOARD_LAYOUT.cards.length);
    expect(result).toEqual({ ok: true, value: patch.dashboardLayout });
  });

  it('accepts only known cards and widths, each once', () => {
    const validator = validatorOf(saveDashboardLayout);
    expect(validator.safeParse({ cards: [{ id: 'flow', visible: true, width: 'full' }] }).success).toBe(true);
    expect(validator.safeParse({ cards: [{ id: 'nope', visible: true, width: 'full' }] }).success).toBe(false);
    expect(validator.safeParse({ cards: [{ id: 'flow', visible: true, width: 'half' }] }).success).toBe(false);
    const twice = { id: 'flow', visible: true, width: 'full' };
    expect(validator.safeParse({ cards: [twice, twice] }).success).toBe(false);
  });

  it('refuses a request without a session', async () => {
    expect(await call(saveDashboardLayout, { context: requestContext(null), data: DEFAULT_DASHBOARD_LAYOUT })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
    expect(fake.preferences.update).not.toHaveBeenCalled();
  });
});
