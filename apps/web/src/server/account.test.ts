// SPDX-License-Identifier: AGPL-3.0-only
import type { Device } from '@wf/auth/auth';
import type { SecurityEvent } from '@wf/db/security-events';
import { describe, expect, it, vi } from 'vitest';
import { HISTORY_PAGE_SIZE, loadHistory, loadSecurity, toDeviceView, toEventView } from './account.ts';

const CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36';
const at = new Date('2026-10-18T09:00:00Z');

const event = (overrides: Partial<SecurityEvent> = {}): SecurityEvent => ({
  id: '0192a6c4-0000-7000-8000-0000000000e1',
  type: 'sign_in',
  ipHash: 'a'.repeat(64),
  userAgent: CHROME,
  meta: {},
  at,
  ...overrides,
});

const device: Device = {
  id: 'session-1',
  label: 'Chrome · macOS',
  userAgent: CHROME,
  createdAt: at,
  expiresAt: at,
  current: true,
};

describe('toDeviceView', () => {
  it('drops the raw user agent', () => {
    expect(toDeviceView(device)).toEqual({
      id: 'session-1',
      label: 'Chrome · macOS',
      createdAt: at,
      expiresAt: at,
      current: true,
    });
  });
});

describe('toEventView', () => {
  it('describes the device and keeps only the known, well-typed details', () => {
    const view = toEventView(
      event({
        meta: {
          method: 'totp',
          factor: 'password',
          name: 'MacBook',
          remainingAttempts: 3,
          count: 2,
          newDevice: true,
          device: 'fingerprint',
          lockedUntil: 7,
        },
      }),
    );
    expect(view).toEqual({
      id: '0192a6c4-0000-7000-8000-0000000000e1',
      type: 'sign_in',
      at,
      device: 'Chrome · macOS',
      detail: { method: 'totp', factor: 'password', name: 'MacBook', remainingAttempts: 3, count: 2, newDevice: true },
    });
    expect(JSON.stringify(view)).not.toContain('a'.repeat(64));
  });

  it('ignores details of the wrong type', () => {
    const view = toEventView(event({ userAgent: null, meta: { method: 1, remainingAttempts: '3', newDevice: false } }));
    expect(view.detail).toEqual({});
    expect(view.device).toBeNull();
  });
});

describe('loadHistory', () => {
  it('reads one page, newest first, from the given cursor', async () => {
    const list = vi.fn(() => Promise.resolve({ events: [event()], nextBefore: 'cursor' }));
    expect(await loadHistory({ list }, 'user-1', undefined)).toMatchObject({ nextBefore: 'cursor' });
    expect(list).toHaveBeenLastCalledWith('user-1', { limit: HISTORY_PAGE_SIZE });
    await loadHistory({ list }, 'user-1', 'cursor');
    expect(list).toHaveBeenLastCalledWith('user-1', { limit: HISTORY_PAGE_SIZE, before: 'cursor' });
  });
});

describe('loadSecurity', () => {
  it('combines 2FA status, sign-in methods, passkeys, devices, and history', async () => {
    const overview = await loadSecurity(
      {
        listDevices: () => Promise.resolve([device]),
        listPasskeys: () =>
          Promise.resolve([
            { id: 'pk-1', name: 'MacBook', createdAt: at },
            { id: 'pk-2', createdAt: at },
          ]),
        listProviders: () => Promise.resolve(['google']),
        events: { list: () => Promise.resolve({ events: [], nextBefore: null }) },
      },
      { id: 'user-1', twoFactorEnabled: null },
    );
    expect(overview).toEqual({
      twoFactorEnabled: false,
      hasPassword: false,
      googleLinked: true,
      passkeys: [
        { id: 'pk-1', name: 'MacBook', createdAt: at },
        { id: 'pk-2', name: null, createdAt: at },
      ],
      devices: [toDeviceView(device)],
      history: { events: [], nextBefore: null },
    });
    const withPassword = await loadSecurity(
      {
        listDevices: () => Promise.resolve([]),
        listPasskeys: () => Promise.resolve([]),
        listProviders: () => Promise.resolve(['credential']),
        events: { list: () => Promise.resolve({ events: [], nextBefore: null }) },
      },
      { id: 'user-1', twoFactorEnabled: true },
    );
    expect(withPassword).toMatchObject({ twoFactorEnabled: true, hasPassword: true, googleLinked: false });
  });
});
