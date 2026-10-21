// SPDX-License-Identifier: AGPL-3.0-only
import { isRedirect } from '@tanstack/react-router';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../../test/render.tsx';
import type { Viewer } from '../server/gate.ts';
import { Route } from './_app.tsx';

const ledger = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  listCategories: vi.fn(),
  listTags: vi.fn(),
  getReferenceRate: vi.fn(),
}));
vi.mock('../server/fn/ledger.ts', () => ledger);
const writes = vi.hoisted(() => ({
  recordTransaction: vi.fn(),
  removeTransactions: vi.fn(),
  restoreTransactions: vi.fn(),
  listDrafts: vi.fn(),
  saveDraft: vi.fn(),
  removeDraft: vi.fn(),
  listTransactionDays: vi.fn(),
}));
vi.mock('../server/fn/transactions-write.ts', () => writes);
vi.mock('../server/fn/budget.ts', () => ({
  getBudgetStatus: () => Promise.resolve({ ok: false, code: 'NOT_FOUND' }),
}));

afterEach(() => {
  vi.restoreAllMocks();
});
const transactions = vi.hoisted(() => ({ countPeriodTransactions: vi.fn() }));
vi.mock('../server/fn/transactions.ts', () => transactions);
const schedules = vi.hoisted(() => ({ countActiveSubscriptions: vi.fn(), createRecurrence: vi.fn() }));
vi.mock('../server/fn/schedules.ts', () => schedules);
vi.mock('../server/fn/debts.ts', () => ({
  getCardPaymentContext: vi.fn(),
  recordCardInstallment: vi.fn(),
  recordCardPayment: vi.fn(),
}));
const review = vi.hoisted(() => ({ getReviewCounts: vi.fn() }));
vi.mock('../server/fn/review.ts', () => review);
const notifications = vi.hoisted(() => ({
  getNotificationCounts: vi.fn(),
  getNextReminder: vi.fn(),
  listNotifications: vi.fn(),
  markNotificationsRead: vi.fn(),
}));
vi.mock('../server/fn/notifications.ts', () => notifications);
// The reconcile provider's server functions only run when it opens.
vi.mock('../server/fn/accounts.ts', () => ({ reconcileAccount: vi.fn() }));

const VIEWER: Viewer = {
  id: 'u1',
  sessionId: 's1',
  name: 'Sari',
  email: 'sari@example.test',
  image: null,
  locale: 'id',
  timezone: 'Asia/Jakarta',
  role: 'user',
  twoFactorEnabled: false,
  onboardingStep: null,
};

function beforeLoad(viewer: Viewer | null, href = '/settings/security?x=1') {
  const hook = Route.options.beforeLoad;
  if (typeof hook !== 'function') throw new Error('_app beforeLoad missing');
  try {
    return hook({ context: { gate: { viewer } }, location: { href } } as never);
  } catch (error) {
    return error;
  }
}

describe('/_app layout', () => {
  it('sends signed-out visitors to sign in, coming back afterwards', () => {
    const redirect = beforeLoad(null);
    expect(isRedirect(redirect)).toBe(true);
    expect(redirect).toMatchObject({ options: { to: '/sign-in', search: { redirect: '/settings/security?x=1' } } });
  });

  it('makes admins without two-step verification enroll first', () => {
    const redirect = beforeLoad({ ...VIEWER, role: 'admin' });
    expect(isRedirect(redirect)).toBe(true);
    expect(redirect).toMatchObject({ options: { to: '/two-factor-setup' } });
  });

  it('sends a user who has not finished the onboarding to the step they are on, after the admin 2FA gate', () => {
    const redirect = beforeLoad({ ...VIEWER, onboardingStep: 'accounts' });
    expect(isRedirect(redirect)).toBe(true);
    expect(redirect).toMatchObject({ options: { to: '/onboarding/$step', params: { step: 'accounts' } } });
    expect(beforeLoad({ ...VIEWER, role: 'admin', onboardingStep: 'profile' })).toMatchObject({
      options: { to: '/two-factor-setup' },
    });
  });

  it('lets users (2FA optional) and enrolled admins in, with the viewer in the context', () => {
    expect(beforeLoad(VIEWER)).toEqual({ viewer: VIEWER });
    const admin = { ...VIEWER, role: 'admin', twoFactorEnabled: true } as const;
    expect(beforeLoad(admin)).toEqual({ viewer: admin });
  });

  it('loads the nav badge counts, none when they fail', async () => {
    const loader = Route.options.loader;
    if (typeof loader !== 'function') throw new Error('_app loader missing');
    transactions.countPeriodTransactions.mockResolvedValue({ ok: true, value: 128 });
    schedules.countActiveSubscriptions.mockResolvedValue({ ok: true, value: 7 });
    review.getReviewCounts.mockResolvedValue({ ok: true, value: { total: 2, byReason: {} } });
    notifications.getNotificationCounts.mockResolvedValue({ ok: true, value: { unread: 4 } });
    expect(await loader({} as never)).toEqual({
      navCounts: { transactions: 128, review: 2, subscriptions: 7, notifications: 4 },
    });
    expect(notifications.getNotificationCounts).toHaveBeenCalledWith({ data: {} });
    notifications.getNotificationCounts.mockResolvedValueOnce({ ok: false, code: 'INTERNAL' });
    expect(await loader({} as never)).toEqual({ navCounts: null });
    expect(transactions.countPeriodTransactions).toHaveBeenCalledWith();
    expect(review.getReviewCounts).toHaveBeenCalledWith();
    expect(schedules.countActiveSubscriptions).toHaveBeenCalledWith();
    schedules.countActiveSubscriptions.mockResolvedValueOnce({ ok: false, code: 'INTERNAL' });
    expect(await loader({} as never)).toEqual({ navCounts: null });
    review.getReviewCounts.mockResolvedValueOnce({ ok: false, code: 'INTERNAL' });
    expect(await loader({} as never)).toEqual({ navCounts: null });
    transactions.countPeriodTransactions.mockResolvedValue({ ok: false, code: 'INTERNAL' });
    review.getReviewCounts.mockResolvedValue({ ok: true, value: { total: 2, byReason: {} } });
    expect(await loader({} as never)).toEqual({ navCounts: null });
    // Offline (FR-D4): no badges instead of a failed page; other failures still fail.
    transactions.countPeriodTransactions.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await loader({} as never)).toEqual({ navCounts: null });
    transactions.countPeriodTransactions.mockRejectedValue(new Error('boom'));
    await expect(loader({} as never)).rejects.toThrow('boom');
  });

  it('wraps its pages in the app shell, with one toast region and the Record Transaction sheet (N)', async () => {
    await page.viewport(1440, 900);
    vi.spyOn(Route, 'useRouteContext').mockReturnValue({ viewer: VIEWER });
    ledger.listAccounts.mockReturnValue(Promise.withResolvers().promise);
    const Layout = Route.options.component as ComponentType;
    const { screen } = await renderApp(<Layout />);
    await expect.element(screen.getByRole('main')).toBeInTheDocument();
    await expect.element(screen.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible();
    await expect.element(screen.getByRole('region', { name: 'Notifikasi' })).toBeInTheDocument();
    await userEvent.keyboard('n');
    await expect.element(page.getByRole('dialog', { name: 'Catat Transaksi' })).toBeVisible();
  });
});
