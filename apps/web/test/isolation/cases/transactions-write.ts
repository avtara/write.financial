// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/transactions-write.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`.
 */
import { randomUUID } from 'node:crypto';
import type { DraftView } from '@wf/db/drafts';
import type { RecordResult } from '@wf/db/ledger-core';
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import {
  A_CLIENT_ID,
  A_DAY,
  A_LEDGER,
  aAccountId,
  aDraftId,
  aId,
  as,
  aTransactionId,
  B_DAY,
  bAccountId,
  bId,
  type Case,
  count,
  draftPayload,
  isDeleted,
  type Name,
  ok,
  superuser,
  UNAUTHENTICATED,
} from '../harness.ts';

/** B's own transaction and draft, made by the `recordTransaction` and `saveDraft` cases. */
export let bTransactionId: string;
let bDraftId: string;

export const cases = {
  recordTransaction: {
    input: () => ({
      type: 'expense',
      clientId: A_CLIENT_ID,
      occurredAt: new Date(`${B_DAY}T05:00:00Z`),
      accountId: bAccountId,
      amountMinor: 25_000n,
      categoryId: null,
      description: 'Kopi B',
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const before = await count('transactions');
      // A's account is not B's to record on.
      expect(
        await as('B', 'recordTransaction', { ...(input as object), clientId: randomUUID(), accountId: aAccountId }),
      ).toEqual({ ok: false, code: 'NOT_FOUND' });
      expect(await count('transactions')).toBe(before);
      // A's idempotency key does not replay A's transaction for B.
      const recorded = await as<Result<RecordResult>>('B', 'recordTransaction', input);
      if (!recorded.ok) throw new Error(`recordTransaction failed: ${recorded.code}`);
      expect(recorded.value).toMatchObject({ created: true });
      expect(recorded.value.id).not.toBe(aTransactionId);
      bTransactionId = recorded.value.id;
      const row = async (id: string) =>
        (await superuser`SELECT user_id, description FROM transactions WHERE id = ${id}`)[0];
      expect(await row(bTransactionId)).toEqual({ user_id: bId, description: 'Kopi B' });
      expect(await row(aTransactionId)).toEqual({ user_id: aId, description: A_LEDGER.transaction });
    },
  },
  removeTransactions: {
    input: () => ({ ids: [aTransactionId] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      expect(await as('B', 'removeTransactions', input)).toEqual(ok({ deleted: [] }));
      expect(await isDeleted(aTransactionId)).toBe(false);
      expect(await as('B', 'removeTransactions', { ids: [bTransactionId, aTransactionId] })).toEqual(
        ok({ deleted: [bTransactionId] }),
      );
      expect([await isDeleted(bTransactionId), await isDeleted(aTransactionId)]).toEqual([true, false]);
    },
  },
  restoreTransactions: {
    input: () => ({ ids: [aTransactionId] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      // A deletes the expense; B cannot bring it back, A can.
      expect(await as('A', 'removeTransactions', input)).toEqual(ok({ deleted: [aTransactionId] }));
      expect(await as('B', 'restoreTransactions', input)).toEqual(ok({ restored: [] }));
      expect(await isDeleted(aTransactionId)).toBe(true);
      expect(await as('B', 'restoreTransactions', { ids: [bTransactionId, aTransactionId] })).toEqual(
        ok({ restored: [bTransactionId] }),
      );
      expect([await isDeleted(bTransactionId), await isDeleted(aTransactionId)]).toEqual([false, true]);
      expect(await as('A', 'restoreTransactions', input)).toEqual(ok({ restored: [aTransactionId] }));
      expect(await isDeleted(aTransactionId)).toBe(false);
    },
  },
  listTransactionDays: {
    input: () => ({ from: '2026-10-01', to: '2026-10-31' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      expect(await as('B', 'listTransactionDays', input)).toEqual(ok([B_DAY]));
      expect(await as('A', 'listTransactionDays', input)).toEqual(ok([A_DAY]));
    },
  },
  saveDraft: {
    input: () => ({ kind: 'transaction', payload: { description: 'Draf B' } }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofA = await draftPayload(aDraftId);
      expect(await as('B', 'saveDraft', { ...(input as object), id: aDraftId })).toEqual({
        ok: false,
        code: 'NOT_FOUND',
      });
      expect(await draftPayload(aDraftId)).toBe(ofA);
      const saved = await as<Result<{ id: string }>>('B', 'saveDraft', input);
      if (!saved.ok) throw new Error(`saveDraft failed: ${saved.code}`);
      bDraftId = saved.value.id;
      expect((await superuser`SELECT user_id FROM drafts WHERE id = ${bDraftId}`)[0]).toEqual({ user_id: bId });
    },
  },
  listDrafts: {
    input: () => ({ kind: 'transaction' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofB = await as<Result<DraftView[]>>('B', 'listDrafts', input);
      expect(ofB.ok && ofB.value.map((draft) => ({ id: draft.id, payload: draft.payload }))).toEqual([
        { id: bDraftId, payload: { description: 'Draf B' } },
      ]);
      const ofA = await as<Result<DraftView[]>>('A', 'listDrafts', input);
      expect(ofA.ok && ofA.value.map((draft) => ({ id: draft.id, payload: draft.payload }))).toEqual([
        { id: aDraftId, payload: { description: A_LEDGER.draft } },
      ]);
    },
  },
  removeDraft: {
    input: () => ({ id: aDraftId }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const ofA = await draftPayload(aDraftId);
      expect(await as('B', 'removeDraft', input)).toEqual({ ok: false, code: 'NOT_FOUND' });
      expect(await draftPayload(aDraftId)).toBe(ofA);
      expect(await as('B', 'removeDraft', { id: bDraftId })).toEqual(ok(null));
      expect(await count('drafts', `user_id = '${bId}'`)).toBe(0);
    },
  },
} satisfies Partial<Record<Name, Case>>;
