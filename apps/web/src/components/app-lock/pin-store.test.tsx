// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import {
  countPins,
  createPin,
  deletePin,
  InvalidPinError,
  isPin,
  matchesPin,
  PIN_ITERATIONS,
  readPin,
  updatePin,
} from './pin-store.ts';

afterEach(async () => {
  await deletePin('user-a');
  await deletePin('user-b');
});

describe('the device PIN store', () => {
  it('keeps only a salted PBKDF2 hash per user, and recognises the PIN by it', async () => {
    expect(await readPin('user-a')).toBeNull();
    const created = await createPin('user-a', '123456', 5, 1_000);
    expect(created).toMatchObject({
      userId: 'user-a',
      iterations: PIN_ITERATIONS,
      timeoutMinutes: 5,
      failedAttempts: 0,
      lastActiveAt: 1_000,
    });
    expect(PIN_ITERATIONS).toBeGreaterThanOrEqual(310_000);
    expect(created.salt).toHaveLength(16);
    expect(created.hash).toHaveLength(32);
    // Nothing stored spells the PIN.
    expect(JSON.stringify(await readPin('user-a'))).not.toContain('123456');
    const stored = await readPin('user-a');
    expect(stored).toEqual(created);
    if (stored === null) throw new Error('no record');
    expect(await matchesPin(stored, '123456')).toBe(true);
    expect(await matchesPin(stored, '123457')).toBe(false);
    expect(await matchesPin({ ...stored, hash: stored.hash.slice(0, 16) }, '123456')).toBe(false);

    // The same PIN for another user gets its own salt, so its own hash.
    const other = await createPin('user-b', '123456', 1, 2_000);
    expect(other.hash).not.toEqual(created.hash);
    expect(await countPins()).toBe(2);
  });

  it('refuses anything but exactly six digits', async () => {
    expect(isPin('012345')).toBe(true);
    expect(isPin('12345')).toBe(false);
    expect(isPin('1234567')).toBe(false);
    expect(isPin('12345a')).toBe(false);
    await expect(createPin('user-a', '12345', 5, 0)).rejects.toThrow(InvalidPinError);
    expect(await readPin('user-a')).toBeNull();
  });

  it('updates a record from its stored state, and removes it', async () => {
    await createPin('user-a', '654321', 5, 0);
    const bump = (current: { failedAttempts: number }) => ({ failedAttempts: current.failedAttempts + 1 });
    await updatePin('user-a', bump);
    expect(await updatePin('user-a', bump)).toMatchObject({ failedAttempts: 2, timeoutMinutes: 5 });
    expect(await updatePin('user-a', () => ({ timeoutMinutes: 30, lastActiveAt: 9 }))).toMatchObject({
      failedAttempts: 2,
      timeoutMinutes: 30,
      lastActiveAt: 9,
    });
    await deletePin('user-a');
    expect(await readPin('user-a')).toBeNull();
    expect(await updatePin('user-a', bump)).toBeNull();
    expect(await countPins()).toBe(0);
  });

  it('rejects when IndexedDB refuses the database', async () => {
    // A newer version of the database (as from a later release) cannot be opened at this one.
    const settled = (request: IDBRequest) => {
      const { promise, resolve } = Promise.withResolvers<undefined>();
      request.onsuccess = () => {
        resolve(undefined);
      };
      return promise;
    };
    const newer = indexedDB.open('wf-app-lock', 99);
    await settled(newer);
    newer.result.close();
    await expect(readPin('user-a')).rejects.toThrow(DOMException);
    await settled(indexedDB.deleteDatabase('wf-app-lock'));
  });
});
