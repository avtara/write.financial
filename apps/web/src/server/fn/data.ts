// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › Data (FR-A11, FR-ST5): "Ekspor semua data" (JSON + CSV) and account deletion with its 7-day grace
 * period. Export and deletion both require two-step verification (FR-A9); the user always comes from the session.
 * The downloadable files themselves are served by `/api/data/export` (`../export-file.ts`); `exportMyData` returns
 * the same bytes for tests and for the isolation harness. Deleting now is deliberately not offered: the grace
 * period is the design (cancel instead), and the worker's daily job performs the actual purge.
 */
import { createServerFn } from '@tanstack/react-start';
import { attempt, requireSession, type Result } from '../access.ts';
import { buildExport } from '../export-file.ts';
import { services } from '../runtime.ts';

/**
 * What Settings › Data shows: whether a deletion is pending, and when the grace period ends. `deletionRequestedAt` is
 * set while the user is within (or, until the worker runs, past) the 7-day grace period; `deleteAfter` is it + 7 days,
 * the day the copy shows as the day the account is deleted. Both are set together or neither is.
 */
export type DataSettings =
  | { readonly deletionRequestedAt: null; readonly deleteAfter: null }
  | { readonly deletionRequestedAt: string; readonly deleteAfter: string };

/** The moment the grace period of a deletion requested at `deletionRequestedAt` ends. */
export function deleteAfterOf(deletionRequestedAt: Date): Date {
  return new Date(deletionRequestedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
}

/** Settings › Data: whether an account deletion is pending (and until when), for the section's card. */
export const getDataSettings = createServerFn({ method: 'GET' }).handler(
  async ({ context }): Promise<Result<DataSettings>> => {
    const { now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      const requestedAt = user.deletionRequestedAt ?? null;
      return requestedAt === null
        ? { deletionRequestedAt: null, deleteAfter: null }
        : { deletionRequestedAt: requestedAt.toISOString(), deleteAfter: deleteAfterOf(requestedAt).toISOString() };
    });
  },
);

/**
 * "Ekspor semua data" (FR-A9/A11): the user's rows from every user-owned data table as JSON plus the CSV of the
 * main ledger. Requires 2FA; the payload holds the user's own data only (RLS), with auth secrets and ciphertext
 * columns stripped (see `@wf/db/export`).
 */
export const exportMyData = createServerFn({ method: 'GET' }).handler(
  async ({ context }): Promise<Result<{ exportedAt: string; json: string; csv: string }>> => {
    const { now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, { twoFactor: true }, now());
      const { exportedAt, json, csv } = await buildExport(user.id);
      return { exportedAt: exportedAt.toISOString(), json, csv };
    });
  },
);

/** Starting the 7-day grace period (FR-A11). Requires 2FA; recorded in the security history (FR-A10). */
export const requestAccountDeletion = createServerFn({ method: 'POST' }).handler(
  async ({ context }): Promise<Result<DataSettings>> => {
    const { accountDeletion, securityEvents, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, { twoFactor: true }, now());
      const deleteAfter = await accountDeletion.request(user.id, now());
      await securityEvents.append(user.id, {
        type: 'account_deletion_requested',
        ipHash: null,
        userAgent: context.headers.get('user-agent'),
      });
      return { deletionRequestedAt: now().toISOString(), deleteAfter: deleteAfter.toISOString() };
    });
  },
);

/** Cancelling during the grace period (FR-A11, "Batalkan penghapusan"). Requires 2FA; recorded (FR-A10). */
export const cancelAccountDeletion = createServerFn({ method: 'POST' }).handler(
  async ({ context }): Promise<Result<DataSettings>> => {
    const { accountDeletion, securityEvents, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, { twoFactor: true }, now());
      if (await accountDeletion.cancel(user.id)) {
        await securityEvents.append(user.id, {
          type: 'account_deletion_cancelled',
          ipHash: null,
          userAgent: context.headers.get('user-agent'),
        });
      }
      return { deletionRequestedAt: null, deleteAfter: null };
    });
  },
);
