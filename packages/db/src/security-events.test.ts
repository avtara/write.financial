// SPDX-License-Identifier: AGPL-3.0-only
import { hmacSha256Hex } from '@wf/crypto/hash';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, startMigrated, PGLITE_HOOK_TIMEOUT, type TestDatabase } from '../test/pglite.ts';
import { InvalidUserIdError } from './db.ts';
import { createSecurityEvents, MAX_PAGE_SIZE, type SecurityEvents } from './security-events.ts';

let test: TestDatabase;
let events: SecurityEvents;
let alice: string;
let bob: string;

const ipHash = hmacSha256Hex('test-ip-key', '203.0.113.7');

beforeAll(async () => {
  test = await startMigrated();
  events = createSecurityEvents(test.db);
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  alice = await insertUser(test, 'alice@example.test');
  bob = await insertUser(test, 'bob@example.test');
});

const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);

describe('append', () => {
  it('records the event for the session user with a hashed IP, a capped user agent, and meta', async () => {
    await asApp(() =>
      events.append(alice, { type: 'sign_in', ipHash, userAgent: 'x'.repeat(600), meta: { newDevice: true } }),
    );
    const [event] = (await asApp(() => events.list(alice, { limit: 10 }))).events;
    expect(event).toMatchObject({ type: 'sign_in', ipHash, meta: { newDevice: true } });
    expect(event?.userAgent).toHaveLength(512);
    expect(event?.at).toBeInstanceOf(Date);
  });

  it('defaults meta to an empty object and accepts unknown IP and user agent', async () => {
    await test.as('wf_auth', () => events.append(alice, { type: 'password_changed', ipHash: null, userAgent: null }));
    expect((await asApp(() => events.list(alice, { limit: 10 }))).events).toMatchObject([
      { type: 'password_changed', ipHash: null, userAgent: null, meta: {} },
    ]);
  });

  it('refuses a raw IP address in place of the hash', async () => {
    await expect(
      asApp(() => events.append(alice, { type: 'sign_in', ipHash: '203.0.113.7', userAgent: null })),
    ).rejects.toThrow('ipHash must be a lowercase hex HMAC-SHA256, not a raw IP address');
  });

  it('rejects a user id that is not a UUID', async () => {
    await expect(events.append('', { type: 'sign_in', ipHash: null, userAgent: null })).rejects.toBeInstanceOf(
      InvalidUserIdError,
    );
  });
});

describe('list', () => {
  it('pages through the user’s own events, newest first', async () => {
    for (const type of ['sign_in', 'two_factor_enabled', 'passkey_added', 'sign_out'] as const) {
      await asApp(() => events.append(alice, { type, ipHash: null, userAgent: null }));
    }
    await asApp(() => events.append(bob, { type: 'sign_in', ipHash: null, userAgent: null }));

    const first = await asApp(() => events.list(alice, { limit: 3 }));
    expect(first.events.map((event) => event.type)).toEqual(['sign_out', 'passkey_added', 'two_factor_enabled']);
    expect(first.nextBefore).toBe(first.events[2]?.id);

    const second = await asApp(() => events.list(alice, { limit: 3, before: first.nextBefore ?? '' }));
    expect(second).toMatchObject({ events: [{ type: 'sign_in' }], nextBefore: null });

    expect((await asApp(() => events.list(bob, { limit: MAX_PAGE_SIZE }))).events).toHaveLength(1);
  });

  it('ends with nextBefore null when the page is exactly full', async () => {
    await asApp(() => events.append(alice, { type: 'sign_in', ipHash: null, userAgent: null }));
    expect(await asApp(() => events.list(alice, { limit: 1 }))).toMatchObject({ nextBefore: null });
  });

  it.each([0, MAX_PAGE_SIZE + 1, 1.5])('rejects limit %d', async (limit) => {
    await expect(events.list(alice, { limit })).rejects.toThrow(`limit must be an integer 1–${MAX_PAGE_SIZE}`);
  });

  it('rejects a cursor that is not an event id', async () => {
    await expect(events.list(alice, { limit: 1, before: "' or 1=1" })).rejects.toThrow('before must be an event id');
  });
});
