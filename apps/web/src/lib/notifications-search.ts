// SPDX-License-Identifier: AGPL-3.0-only
/** The notifications page's URL state (FR-S5): filters, search, and the date range (the last 30 days by default). */
import type { NotificationType } from '@wf/db/notifications';
import { addDays, type LocalDate } from '@wf/domain/period';

/** How long notifications are kept (the maintenance job deletes older ones). */
export const RETENTION_DAYS = 90;
/** The default range: the last 30 days. */
export const RANGE_DAYS = 30;

export interface NotificationsSearch {
  readonly filter?: 'unread' | undefined;
  readonly type?: NotificationType | undefined;
  readonly q?: string | undefined;
  readonly from?: LocalDate | undefined;
  readonly to?: LocalDate | undefined;
}

/** The range a search means: its own dates, or the last 30 days. */
export function rangeOf(search: NotificationsSearch, today: LocalDate): { start: LocalDate; end: LocalDate } {
  const end = search.to ?? today;
  return { start: search.from ?? addDays(end, 1 - RANGE_DAYS), end };
}
