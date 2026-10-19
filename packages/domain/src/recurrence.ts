// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Repeating schedules (FR-T6, FR-L8): recurring transactions and contributions. Skeleton: the Domain agent completes
 * this module (see local://m3-core-contract.md).
 */

export const RECURRENCE_FREQS = ['weekly', 'monthly', 'yearly'] as const;
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number];

export const RECURRENCE_END_TYPES = ['never', 'after'] as const;
export type RecurrenceEndType = (typeof RECURRENCE_END_TYPES)[number];
