// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/gmail.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`. A has a Gmail connection with an ingest log (seeded as the worker
 * would have written it); B sees none of it, changes none of it, and its own calls answer as "no connection".
 */
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import type { GmailSettings } from '../../../src/server/fn/gmail.ts';
import { aId, as, type Case, superuser, UNAUTHENTICATED } from '../harness.ts';

/** A's connection and two log rows, inserted once, before the first case runs. */
let seeded: Promise<void> | undefined;
function seedA(): Promise<void> {
  seeded ??= (async () => {
    await superuser`
      INSERT INTO gmail_connections (user_id, email, tokens_enc, history_id, status, filters)
      VALUES (${aId}, 'avtara.k@gmail.com', '\\x01', '501', 'connected',
        '{"senders":["bca.co.id"],"keywords":["transaksi"],"ignoreKeywords":["promo"]}')
      ON CONFLICT DO NOTHING`;
    await superuser`
      INSERT INTO email_ingest_logs (user_id, message_id, from_addr, subject, quote_enc, filter_result, outcome,
        confidence, received_at)
      VALUES
        (${aId}, 'msg-a1', 'cs@bca.co.id', 'Transaksi Rp 350.000', '\\x01', 'passed', 'pending', 97,
         '2026-10-17T18:02:00Z'),
        (${aId}, 'msg-a2', 'no@shop.co.id', 'Flash sale', '\\x01', 'filtered', 'filtered', null,
         '2026-10-17T19:00:00Z')`;
  })();
  return seeded;
}

/** A's connection and log as stored; B's calls must leave them unchanged. */
const aRows = async () => ({
  connection: await superuser`SELECT email, status, history_id FROM gmail_connections WHERE user_id = ${aId}`,
  logs: await superuser`SELECT message_id, outcome FROM email_ingest_logs WHERE user_id = ${aId} ORDER BY message_id`,
});

export const cases = {
  getGmailSettings: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      await seedA();
      // B has no connection: the answer is the empty card, never a trace of A's email or address.
      const ofB = await as<Result<GmailSettings>>('B', 'getGmailSettings', {});
      expect(ofB.ok && ofB.value.connection).toBeNull();
      expect(ofB.ok && ofB.value.stats).toMatchObject({ received: 0, passed: 0, pending: 0 });
      expect(ofB.ok && ofB.value.log).toEqual([]);
      expect(JSON.stringify(ofB)).not.toContain('avtara.k@gmail.com');
      expect(JSON.stringify(ofB)).not.toContain('msg-a1');
      // A sees the own connection and log; the view carries no token or excerpt material.
      const ofA = await as<Result<GmailSettings>>('A', 'getGmailSettings', {});
      expect(ofA.ok && ofA.value.connection).toMatchObject({ email: 'avtara.k@gmail.com', status: 'connected' });
      expect(ofA.ok && ofA.value.log.map((row) => row.messageId)).toEqual(['msg-a2', 'msg-a1']);
      expect(JSON.stringify(ofA)).not.toContain('tokens_enc');
      expect(JSON.stringify(ofA)).not.toContain('quote_enc');
    },
  },
  updateFilters: {
    input: () => ({ senders: ['shop.co.id'], keywords: ['tagihan'], ignoreKeywords: ['newsletter'] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await seedA();
      const before = await aRows();
      // B has no connection: refused as not found, and A's filters are untouched.
      expect(await as('B', 'updateFilters', input)).toEqual({ ok: false, code: 'NOT_FOUND' });
      expect(await aRows()).toEqual(before);
    },
  },
  testFilters: {
    input: () => ({ senders: ['bank.test'], keywords: ['payment'], ignoreKeywords: ['promo'] }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await seedA();
      const before = await aRows();
      // B has no connection (and no tokens): refused as not found; A's log is untouched by B's dry run.
      expect(await as('B', 'testFilters', input)).toEqual({ ok: false, code: 'NOT_FOUND' });
      expect(await aRows()).toEqual(before);
    },
  },
  disconnectGmail: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await seedA();
      const before = await aRows();
      // B cannot revoke A's connection: without B's own the call is refused and A's stays connected.
      expect(await as('B', 'disconnectGmail', input)).toEqual({ ok: false, code: 'NOT_FOUND' });
      expect(await aRows()).toEqual(before);
    },
  },
  startGmailConnect: {
    input: () => ({ consent: true }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      await seedA();
      const before = await aRows();
      // This isolation instance deliberately has no restricted Google configuration: no consent or egress occurs.
      expect(await as('B', 'startGmailConnect', input)).toEqual({ ok: false, code: 'NOT_FOUND' });
      expect(await aRows()).toEqual(before);
    },
  },
} satisfies Partial<
  Record<'getGmailSettings' | 'updateFilters' | 'testFilters' | 'disconnectGmail' | 'startGmailConnect', Case>
>;
