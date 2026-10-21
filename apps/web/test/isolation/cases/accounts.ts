// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/accounts.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`.
 */
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import type { AccountDetail } from '../../../src/server/fn/accounts.ts';
import {
  aAccountId,
  aLedger,
  as,
  bAccountId,
  bAccountNames,
  bId,
  type Case,
  type Name,
  notFoundForB,
  ok,
  superuser,
  UNAUTHENTICATED,
} from '../harness.ts';

export const cases = {
  createAccount: {
    input: () => ({
      type: 'cash',
      providerName: 'Dompet B',
      displayName: 'Dompet B',
      currency: 'IDR',
      openingBalanceMinor: 50_000n,
      openingDate: '2026-10-01',
      color: 'green',
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const before = await aLedger();
      expect(await as('B', 'createAccount', input)).toMatchObject(ok({ displayName: 'Dompet B' }));
      expect(await bAccountNames()).toEqual(['Rekening B:active', 'Dompet B:active']);
      expect(await aLedger()).toEqual(before);
    },
  },
  updateAccount: {
    input: () => ({ id: aAccountId, patch: { displayName: 'Pwned', showAsCard: true } }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('updateAccount', input);
      expect(await as('B', 'updateAccount', { id: bAccountId, patch: { displayName: 'Rekening B' } })).toMatchObject(
        ok({ displayName: 'Rekening B' }),
      );
    },
  },
  getAccountDetail: {
    input: () => ({ id: aAccountId }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('getAccountDetail', input);
      const ofB = await as<Result<AccountDetail>>('B', 'getAccountDetail', { id: bAccountId });
      expect(
        ofB.ok && ofB.value.recent.every((row) => row.accountId === bAccountId || row.toAccountId === bAccountId),
      ).toBe(true);
    },
  },
  reconcileAccount: {
    input: () => ({ id: aAccountId, mode: 'correction', actualBalanceMinor: 1n }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('reconcileAccount', input);
    },
  },
  reconcileAccounts: {
    input: () => ({
      occurredAt: new Date('2026-10-15T05:00:00Z'),
      items: [
        { id: aAccountId, actualBalanceMinor: 1n, categoryId: null, clientId: '0192a6c4-0000-7000-8000-0000000000d1' },
      ],
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('reconcileAccounts', input);
    },
  },
  reorderAccounts: {
    input: () => ({ ids: [aAccountId] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('reorderAccounts', input);
    },
  },
  archiveAccount: {
    // B tries to move its balance into A's account.
    input: () => ({
      id: bAccountId,
      transfer: { toAccountId: aAccountId, clientId: '0192a6c4-0000-7000-8000-0000000000d2' },
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('archiveAccount', input);
      expect(await bAccountNames()).toEqual(['Rekening B:active', 'Dompet B:active']);
      await notFoundForB('archiveAccount', { id: aAccountId });
      const dompet = (
        await superuser<{ id: string }[]>`
        SELECT id::text FROM accounts WHERE user_id = ${bId} AND display_name = 'Dompet B'`
      )[0]?.id;
      expect(await as('B', 'archiveAccount', { id: dompet })).toMatchObject(ok({ status: 'archived' }));
    },
  },
  restoreAccount: {
    input: () => ({ id: aAccountId }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('restoreAccount', input);
    },
  },
  deleteAccount: {
    input: () => ({ id: aAccountId }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('deleteAccount', input);
      const dompet = (
        await superuser<{ id: string }[]>`
        SELECT id::text FROM accounts WHERE user_id = ${bId} AND display_name = 'Dompet B'`
      )[0]?.id;
      expect(await as('B', 'deleteAccount', { id: dompet })).toEqual(ok({ deletedTransactions: 0 }));
      expect(await bAccountNames()).toEqual(['Rekening B:active']);
    },
  },
  setAccountLogo: {
    input: () => {
      const form = new FormData();
      form.set('id', aAccountId);
      form.set('file', new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' }));
      return form;
    },
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      // Refused before the image is read or anything reaches storage.
      await notFoundForB('setAccountLogo', input);
    },
  },
  removeAccountLogo: {
    input: () => ({ id: aAccountId }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await notFoundForB('removeAccountLogo', input);
    },
  },
} satisfies Partial<Record<Name, Case>>;
