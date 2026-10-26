// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import {
  aAccountId,
  aId,
  as,
  type Case,
  type Name,
  services,
  superuser,
  NOT_FOUND,
  UNAUTHENTICATED,
} from '../harness.ts';
const ID = randomUUID();
let seeded: Promise<void> | undefined;
const seed = () =>
  (seeded ??= services.receipts
    .stage(aId, {
      id: ID,
      revision: randomUUID(),
      provider: 'openrouter',
      payload: {
        name: 'private-receipt-a.jpg',
        original: { key: `u/${aId}/${randomUUID()}`, size: 8, sha256: 'a'.repeat(64), mime: 'image/webp' },
        pages: [],
        timeZone: 'Asia/Jakarta',
        evidence: null,
      },
    })
    .then(() => undefined));
const rows = () => superuser`SELECT * FROM receipt_uploads WHERE user_id = ${aId}`;
export const cases = {
  uploadReceipt: {
    input: () => {
      const form = new FormData();
      form.set('id', ID);
      form.set('file', new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' }));
      return form;
    },
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await seed();
      const before = await rows();
      expect(await as('B', 'uploadReceipt', input)).toMatchObject({ ok: false });
      expect(await rows()).toEqual(before);
    },
  },
  getReceipt: {
    input: () => ({ id: ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await seed();
      expect(await as('B', 'getReceipt', input)).toEqual(NOT_FOUND);
    },
  },
  cancelReceipt: {
    input: () => ({ id: ID }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await seed();
      const before = await rows();
      expect(await as('B', 'cancelReceipt', input)).toEqual(NOT_FOUND);
      expect(await rows()).toEqual(before);
    },
  },
  prepareManualReceipt: {
    input: () => ({
      id: ID,
      accountId: aAccountId,
      amountMinor: 96500n,
      categoryId: null,
      occurredAt: new Date(),
      description: 'Manual',
      note: '',
      tags: [],
    }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await seed();
      const before = await rows();
      expect(await as('B', 'prepareManualReceipt', input)).toEqual(NOT_FOUND);
      expect(await rows()).toEqual(before);
    },
  },
} satisfies Partial<Record<Name, Case>>;
