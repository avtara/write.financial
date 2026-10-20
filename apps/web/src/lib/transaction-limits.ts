// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Limits of the Transactions page shared by the server functions and the UI. They live outside
 * `server/fn/transactions.ts` so the browser bundle never pulls in that module's server-only imports (the image
 * pipeline's native `sharp`).
 */

/** Rows per request ("Muat lebih banyak" / infinite scroll). */
export const PAGE_SIZE = 100;
/** FR-L4 "maks 3": images per transaction besides the one receipt. */
export const MAX_IMAGES = 3;
/** FR-L5: parts of a split. */
export const MAX_SPLIT_PARTS = 10;
