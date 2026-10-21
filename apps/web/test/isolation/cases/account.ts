// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/account.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`.
 */
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import type { DeviceView, SecurityHistory, SecurityOverview } from '../../../src/server/account.ts';
import {
  aId,
  as,
  aSnapshot,
  B,
  b2,
  bId,
  browsers,
  type Case,
  currentSessionId,
  eventIds,
  type Name,
  ok,
  profileRow,
  sessionIds,
  UNAUTHENTICATED,
} from '../harness.ts';

export const cases = {
  getProfile: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      expect(await as('B', 'getProfile')).toEqual(
        ok({ name: B.name, nickname: null, locale: 'en', timezone: 'Asia/Makassar' }),
      );
      expect(await as('A', 'getProfile')).toEqual(ok(await profileRow(aId)));
    },
  },
  updateProfile: {
    input: () => ({ name: 'Budi S.', nickname: 'Budi', locale: 'id', timezone: 'Asia/Jakarta' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await aSnapshot();
      expect(await as('B', 'updateProfile', input)).toEqual(ok(input));
      expect(await profileRow(bId)).toEqual(input);
      expect(await aSnapshot()).toEqual(a);
    },
  },
  saveLocale: {
    input: () => ({ locale: 'en' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      const a = await aSnapshot();
      expect(await as('B', 'saveLocale', input)).toEqual(ok(null));
      expect(await profileRow(bId)).toEqual({
        name: 'Budi S.',
        nickname: 'Budi',
        locale: 'en',
        timezone: 'Asia/Jakarta',
      });
      expect(await aSnapshot()).toEqual(a);
    },
  },
  getSecurity: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const result = await as<Result<SecurityOverview>>('B', 'getSecurity');
      if (!result.ok) throw new Error(`getSecurity failed: ${result.code}`);
      const { devices, history, ...rest } = result.value;
      expect(rest).toEqual({ twoFactorEnabled: true, hasPassword: true, googleLinked: false, passkeys: [] });
      expect(devices.map((device) => device.id).sort()).toEqual(await sessionIds(bId));
      expect(devices.filter((device) => device.current).map((device) => device.id)).toEqual([
        await currentSessionId(browsers.B),
      ]);
      expect(history.events.map((event) => event.id)).toEqual(await eventIds(bId));
      expect(history.nextBefore).toBeNull();
      const ofA = await as<Result<SecurityOverview>>('A', 'getSecurity');
      expect(ofA.ok && ofA.value.history.events.map((event) => event.id)).toEqual(await eventIds(aId));
    },
  },
  getSecurityHistory: {
    input: () => ({ before: '0192a6c4-0000-7000-8000-000000000000' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const [newestOfA = ''] = await eventIds(aId);
      const olderOfB = (await eventIds(bId)).filter((id) => id < newestOfA);
      expect(olderOfB.length).toBeGreaterThan(0);
      const result = await as<Result<SecurityHistory>>('B', 'getSecurityHistory', { before: newestOfA });
      expect(result.ok && { ids: result.value.events.map((event) => event.id), next: result.value.nextBefore }).toEqual(
        { ids: olderOfB, next: null },
      );
    },
  },
  listDevices: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const result = await as<Result<DeviceView[]>>('B', 'listDevices');
      expect(result.ok && result.value.map((device) => device.id).sort()).toEqual(await sessionIds(bId));
      expect(result.ok && result.value.filter((device) => device.current).map((device) => device.id)).toEqual([
        await currentSessionId(browsers.B),
      ]);
    },
  },
  revokeDevice: {
    input: () => ({ id: '0192a6c4-0000-7000-8000-000000000000' }),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aSnapshot();
      const ofB = await sessionIds(bId);
      for (const id of a.sessions) {
        expect(await as('B', 'revokeDevice', { id })).toEqual({ ok: false, code: 'DEVICE_NOT_FOUND' });
      }
      expect(await aSnapshot()).toEqual(a);
      expect(a.signedIn.every((id) => typeof id === 'string')).toBe(true);
      expect(await sessionIds(bId)).toEqual(ofB);
    },
  },
  revokeOtherDevices: {
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      const a = await aSnapshot();
      const current = await currentSessionId(browsers.B);
      const others = (await sessionIds(bId)).length - 1;
      expect(others).toBeGreaterThan(0);
      expect(await as('B', 'revokeOtherDevices')).toEqual(ok({ count: others }));
      expect(await sessionIds(bId)).toEqual([current]);
      expect(await b2.session()).toBeNull();
      expect(await aSnapshot()).toEqual(a);
    },
  },
} satisfies Partial<Record<Name, Case>>;
