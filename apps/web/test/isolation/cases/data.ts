// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/data.ts` (FR-A11): the data export holds only the
 * caller's own rows, and the deletion request and cancel touch the caller's own `users` row only. Runs last in
 * the matrix, so the request B makes here is cancelled again before the run ends.
 */
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import type { DataSettings } from '../../../src/server/fn/data.ts';
import { aId, as, bId, type Case, count, ok, superuser, UNAUTHENTICATED } from '../harness.ts';

export const cases = {
  getDataSettings: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      // B sees only B's (empty) state: A's request, once it exists, never leaks into B's answer.
      expect(await as<Result<DataSettings>>('B', 'getDataSettings')).toEqual(
        ok({ deletionRequestedAt: null, deleteAfter: null }),
      );
      await superuser`UPDATE users SET deletion_requested_at = now() WHERE id = ${aId}`;
      expect(await as<Result<DataSettings>>('B', 'getDataSettings')).toEqual(
        ok({ deletionRequestedAt: null, deleteAfter: null }),
      );
      const ofA = await as<Result<DataSettings>>('A', 'getDataSettings');
      expect(ofA.ok && ofA.value.deletionRequestedAt !== null).toBe(true);
      await superuser`UPDATE users SET deletion_requested_at = null WHERE id = ${aId}`;
    },
  },
  exportMyData: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      // B's export holds B's own rows with their names; none of A's secret names (the run's final leak scan
      // checks every response for A's identifiers besides).
      const ofB = await as<Result<{ exportedAt: string; json: string; csv: string }>>('B', 'exportMyData');
      expect(ofB.ok).toBe(true);
      if (!ofB.ok) return;
      expect(ofB.value.json).toContain('Rekening B');
      expect(ofB.value.csv).toContain('id,occurred_at,type');
      expect(ofB.value.json).not.toContain('Rahasia');
      // A exports A's own rows only.
      const ofA = await as<Result<{ json: string }>>('A', 'exportMyData');
      expect(ofA.ok && ofA.value.json).toContain('Rahasia A');
      expect(ofA.ok && ofA.value.json).not.toContain('Rekening B');
    },
  },
  requestAccountDeletion: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      // B starts B's own 7-day grace period; A's account (and its deletion state) is untouched.
      expect(await as<Result<DataSettings>>('B', 'requestAccountDeletion')).toMatchObject(
        ok({ deleteAfter: expect.any(String) as unknown }),
      );
      expect(await count('users', `id = '${bId}' AND deletion_requested_at IS NOT NULL`)).toBe(1);
      expect(await count('users', `id = '${aId}' AND deletion_requested_at IS NOT NULL`)).toBe(0);
      // The request is in B's security history (FR-A10), not A's.
      expect(
        await superuser`SELECT type FROM security_events WHERE user_id = ${bId} AND type = 'account_deletion_requested'`,
      ).toHaveLength(1);
      expect(
        await superuser`SELECT type FROM security_events WHERE user_id = ${aId} AND type = 'account_deletion_requested'`,
      ).toHaveLength(0);
    },
  },
  cancelAccountDeletion: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      // B cancels during the grace period, which clears the request again for the rest of the run.
      expect(await as<Result<DataSettings>>('B', 'cancelAccountDeletion')).toEqual(
        ok({ deletionRequestedAt: null, deleteAfter: null }),
      );
      expect(await count('users', `id = '${bId}' AND deletion_requested_at IS NOT NULL`)).toBe(0);
      expect(
        await superuser`SELECT type FROM security_events WHERE user_id = ${bId} AND type = 'account_deletion_cancelled'`,
      ).toHaveLength(1);
    },
  },
} satisfies Partial<
  Record<'getDataSettings' | 'exportMyData' | 'requestAccountDeletion' | 'cancelAccountDeletion', Case>
>;
