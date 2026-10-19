// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Subscriptions (FR-SUB1–SUB6). Skeleton: the Domain agent completes this module (see local://m3-core-contract.md).
 */

export const SUBSCRIPTION_CYCLES = ['weekly', 'monthly', 'yearly'] as const;
export type SubscriptionCycle = (typeof SUBSCRIPTION_CYCLES)[number];

export const SUBSCRIPTION_STATUSES = ['active', 'paused', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const CANCEL_MODES = ['after_next_bill', 'now'] as const;
export type CancelMode = (typeof CANCEL_MODES)[number];

export const USAGE_RATINGS = ['often', 'sometimes', 'rarely'] as const;
export type UsageRating = (typeof USAGE_RATINGS)[number];
