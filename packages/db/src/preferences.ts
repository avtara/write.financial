// SPDX-License-Identifier: AGPL-3.0-only
import type { PeriodStartDay } from '@wf/domain/period';
import { eq } from 'drizzle-orm';
import { firstRow, withUser, type Database } from './db.ts';
import { userPreferences } from './schema.ts';

const COLUMNS = {
  theme: userPreferences.theme,
  numberFormat: userPreferences.numberFormat,
  dateFormat: userPreferences.dateFormat,
  weekStart: userPreferences.weekStart,
  hideBalances: userPreferences.hideBalances,
  periodStartDay: userPreferences.periodStartDay,
  periodMode: userPreferences.periodMode,
  notif: userPreferences.notif,
  dashboardLayout: userPreferences.dashboardLayout,
  tablePrefs: userPreferences.tablePrefs,
  ccPaymentPriority: userPreferences.ccPaymentPriority,
};

export type Preferences = Readonly<Omit<typeof userPreferences.$inferSelect, 'userId' | 'createdAt' | 'updatedAt'>>;
export type PreferencesPatch = Partial<Preferences>;

/** What a user without a `user_preferences` row gets; equal to the column defaults (checked by the unit test). */
export const DEFAULT_PREFERENCES: Preferences = Object.freeze({
  theme: 'dark',
  numberFormat: 'locale',
  dateFormat: 'medium',
  weekStart: 'monday',
  hideBalances: false,
  periodStartDay: 1 as PeriodStartDay,
  periodMode: 'fixed_day',
  notif: {},
  dashboardLayout: {},
  tablePrefs: {},
  ccPaymentPriority: [],
});

export interface PreferencesRepository {
  /** The user's preferences, or {@link DEFAULT_PREFERENCES} before the first update. */
  get: (userId: string) => Promise<Preferences>;
  /** Changes the given fields (creating the row on first use) and returns the result. */
  update: (userId: string, patch: PreferencesPatch) => Promise<Preferences>;
}

export function createPreferences(db: Database): PreferencesRepository {
  return {
    get: (userId) =>
      withUser(db, userId, async (tx) => {
        const [row] = await tx.select(COLUMNS).from(userPreferences).where(eq(userPreferences.userId, userId));
        return row ?? DEFAULT_PREFERENCES;
      }),

    update: (userId, patch) =>
      withUser(db, userId, async (tx) => {
        // `userId` last: a patch smuggled past the type system cannot retarget the row.
        const rows = await tx
          .insert(userPreferences)
          .values({ ...patch, userId })
          .onConflictDoUpdate({ target: userPreferences.userId, set: { ...patch, userId, updatedAt: new Date() } })
          .returning(COLUMNS);
        return firstRow(rows, 'user_preferences');
      }),
  };
}
