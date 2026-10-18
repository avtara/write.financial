// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { fakeSession, SETTINGS } from '../../test/fixtures.ts';
import { loadGate, toViewer } from './gate.ts';

describe('toViewer', () => {
  it('keeps what the app shows and nothing secret', () => {
    const viewer = toViewer(fakeSession({ role: 'admin', locale: 'en' }));
    expect(viewer).toEqual({
      id: '0192a6c4-0000-7000-8000-000000000001',
      sessionId: '0192a6c4-0000-7000-8000-0000000000aa',
      name: 'Avtara K.',
      email: 'avtara@example.test',
      image: null,
      locale: 'en',
      timezone: 'Asia/Jakarta',
      role: 'admin',
      twoFactorEnabled: true,
    });
    expect(JSON.stringify(viewer)).not.toContain('session-token');
  });

  it('falls back for unknown or missing values', () => {
    const session = fakeSession({ twoFactorEnabled: false, locale: 'fr' });
    const user = { ...session.user, role: null, timezone: undefined, image: undefined };
    expect(toViewer({ ...session, user })).toMatchObject({
      locale: 'id',
      timezone: 'Asia/Jakarta',
      role: 'user',
      image: null,
      twoFactorEnabled: false,
    });
  });
});

describe('loadGate', () => {
  const deps = (admin: boolean, settings = SETTINGS, session = fakeSession()) => ({
    hasAdmin: () => Promise.resolve(admin),
    instance: () => Promise.resolve(settings),
    session: () => Promise.resolve(session),
    googleEnabled: false,
  });

  it('is pending without an admin, then admin-created, then complete', async () => {
    expect((await loadGate({ ...deps(false), session: () => Promise.resolve(null) })).setup).toBe('pending');
    expect((await loadGate(deps(true))).setup).toBe('admin-created');
    expect((await loadGate(deps(true, { ...SETTINGS, setupCompletedAt: new Date(0) }))).setup).toBe('complete');
  });

  it('carries the viewer and the public instance settings', async () => {
    const gate = await loadGate({ ...deps(true, { ...SETTINGS, registrationMode: 'invite' }), googleEnabled: true });
    expect(gate).toMatchObject({
      viewer: { email: 'avtara@example.test' },
      instanceName: 'Keuangan Keluarga',
      registrationMode: 'invite',
      googleEnabled: true,
    });
    expect((await loadGate({ ...deps(true), session: () => Promise.resolve(null) })).viewer).toBeNull();
  });
});
