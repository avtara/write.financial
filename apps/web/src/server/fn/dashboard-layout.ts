// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Atur dashboard" (FR-D3): the signed-in user's Overview layout, read for `/` and saved by "Simpan tata letak",
 * "Reset ke default", and "Urungkan". It lives in `user_preferences.dashboard_layout`, so it follows the account to
 * every device. The user always comes from the session.
 */
import { createServerFn } from '@tanstack/react-start';
import { DASHBOARD_LAYOUT, dashboardLayoutOf, type DashboardLayout } from '../../lib/dashboard-layout.ts';
import { attempt, requireSession, type Result } from '../access.ts';
import { services } from '../runtime.ts';

/** The saved layout, completed with cards a later release added (the defaults before the first save). */
export const getDashboardLayout = createServerFn({ method: 'GET' }).handler(
  async ({ context }): Promise<Result<DashboardLayout>> => {
    const { now, preferences } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return dashboardLayoutOf((await preferences.get(user.id)).dashboardLayout);
    });
  },
);

/** Saves `data` (completed the same way) and returns what is stored now. */
export const saveDashboardLayout = createServerFn({ method: 'POST' })
  .validator(DASHBOARD_LAYOUT)
  .handler(async ({ context, data }): Promise<Result<DashboardLayout>> => {
    const { now, preferences } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      const layout = dashboardLayoutOf(data);
      const saved = await preferences.update(user.id, { dashboardLayout: { cards: layout.cards } });
      return dashboardLayoutOf(saved.dashboardLayout);
    });
  });
