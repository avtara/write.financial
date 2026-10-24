// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation case for the server function in `src/server/fn/import.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`.
 */
import type { LocalDate } from '@wf/domain/period';
import { expect } from 'vitest';
import type { ImportProposalResult } from '@wf/db/import-review';
import type { Result } from '../../../src/server/access.ts';
import {
  aAccountId,
  aM3Rows,
  as,
  bAccountId,
  bId,
  type Case,
  idsOf,
  NOT_FOUND,
  ok,
  SOME_ID,
  UNAUTHENTICATED,
} from '../harness.ts';

const row = {
  date: '2026-10-05',
  amountMinor: 25_000n,
  direction: 'out',
  description: 'QRIS KOPI B',
  categoryId: null,
  transferAccountId: null,
};

export const cases = {
  requestImport: {
    input: () => ({ accountId: SOME_ID, rows: [row] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aM3Rows();
      // A's account is not B's: NOT_FOUND, and A's rows are untouched.
      expect(await as('B', 'requestImport', { accountId: aAccountId, rows: [row] })).toEqual(NOT_FOUND);
      expect(await aM3Rows()).toEqual(a);
      // B's own import: two valid rows become two pending review items; a replay dedupes; broken rows are rejected.
      const first = await as<Result<ImportProposalResult>>('B', 'requestImport', {
        accountId: bAccountId,
        rows: [row, { ...row, description: 'TRANSFER KELUAR B' }],
      });
      expect(first).toMatchObject(ok({ created: 2, duplicates: 0, rejected: 0 }));
      const itemIds = first.ok ? first.value.itemIds : [];
      expect(await idsOf('review_items', bId, `reason = 'import_row'`)).toEqual(itemIds);
      const replay = await as<ImportProposalResult>('B', 'requestImport', { accountId: bAccountId, rows: [row] });
      expect(replay).toEqual(ok({ created: 0, duplicates: 1, rejected: 0, itemIds: [] }));
      // A row the validator accepts but whose date is not a real day is rejected server-side.
      const broken = await as<ImportProposalResult>('B', 'requestImport', {
        accountId: bAccountId,
        rows: [{ ...row, date: '2026-02-30' as LocalDate }],
      });
      expect(broken).toEqual(ok({ created: 0, duplicates: 0, rejected: 1, itemIds: [] }));
      expect(await aM3Rows()).toEqual(a);
    },
  },
} satisfies Partial<Record<'requestImport', Case>>;
