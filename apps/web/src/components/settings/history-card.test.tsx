// SPDX-License-Identifier: AGPL-3.0-only
import { SECURITY_EVENT_TYPES } from '@wf/db/schema';
import { setLocale } from '@wf/i18n/runtime';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import type { SecurityEventView, SecurityHistory } from '../../server/account.ts';
import { describeDetail, EVENT_LABEL, HistoryCard } from './history-card.tsx';

const server = vi.hoisted(() => ({ getSecurityHistory: vi.fn() }));
vi.mock('../../server/fn/account.ts', () => server);

// The labels call message functions directly; earlier test files may have left another locale.
beforeEach(async () => {
  await setLocale('id', { reload: false });
});

const event = (id: string, overrides: Partial<SecurityEventView> = {}): SecurityEventView => ({
  id,
  type: 'sign_in',
  at: new Date('2026-10-15T03:05:00Z'),
  device: 'Chrome · macOS',
  detail: {},
  ...overrides,
});

describe('EVENT_LABEL', () => {
  it('names every security event type', () => {
    expect(Object.keys(EVENT_LABEL).sort()).toEqual([...SECURITY_EVENT_TYPES].sort());
    for (const type of SECURITY_EVENT_TYPES) expect(EVENT_LABEL[type]()).not.toBe('');
  });
});

describe('describeDetail', () => {
  it('puts the method, factor, name, new device, attempts left, and count into words', () => {
    expect(
      describeDetail({ method: 'password', newDevice: true, remainingAttempts: 3, count: 2, name: 'MacBook' }),
    ).toEqual(['Kata sandi', 'MacBook', 'perangkat baru', 'sisa 3 percobaan', '2 perangkat']);
    expect(describeDetail({ factor: 'totp' })).toEqual(['Aplikasi autentikator']);
    expect(describeDetail({ method: 'carrier-pigeon', newDevice: false })).toEqual(['carrier-pigeon']);
    expect(describeDetail({})).toEqual([]);
  });
});

function Reloadable({ pages }: { pages: readonly SecurityHistory[] }) {
  const [index, setIndex] = useState(0);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setIndex(index + 1);
        }}
      >
        reload
      </button>
      <HistoryCard history={pages[index] as SecurityHistory} timeZone="Asia/Jakarta" />
    </>
  );
}

describe('HistoryCard', () => {
  it('lists the events and loads older ones, and starts over when the first page is reloaded', async () => {
    server.getSecurityHistory.mockResolvedValueOnce({ ok: false, code: 'UNAUTHENTICATED' }).mockResolvedValueOnce({
      ok: true,
      value: {
        events: [
          event('2', { type: 'sign_in_failed', device: null, detail: { factor: 'password', remainingAttempts: 4 } }),
        ],
        nextBefore: null,
      },
    });
    const first: SecurityHistory = {
      events: [event('1', { detail: { method: 'passkey', newDevice: true } })],
      nextBefore: '1',
    };
    const reloaded: SecurityHistory = { events: [event('3', { type: 'password_changed' })], nextBefore: null };
    const { screen } = await renderApp(<Reloadable pages={[first, reloaded]} />);
    const list = screen.getByRole('list', { name: 'Riwayat keamanan' });
    await expect
      .element(list)
      .toHaveTextContent('MasukChrome · macOS · Passkey · perangkat baru15 Okt 2026, 10.05 WIB');
    await expect.element(list.getByRole('time')).toHaveAttribute('datetime', '2026-10-15T03:05:00.000Z');

    const more = screen.getByRole('button', { name: 'Muat lagi' });
    await userEvent.click(more);
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Sesimu sudah berakhir. Masuk lagi.');
    await userEvent.click(more);
    await expect.element(list.getByText('Percobaan masuk gagal')).toBeVisible();
    await expect.element(list.getByText('Perangkat tidak dikenal · Kata sandi · sisa 4 percobaan')).toBeVisible();
    expect(server.getSecurityHistory).toHaveBeenLastCalledWith({ data: { before: '1' } });
    await expect.element(more).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'reload' }));
    await expect.element(list).toHaveTextContent('Kata sandi diubahChrome · macOS15 Okt 2026, 10.05 WIB');
  });

  it('says when there is nothing yet', async () => {
    const { screen } = await renderApp(
      <HistoryCard history={{ events: [], nextBefore: null }} timeZone="Asia/Jakarta" />,
    );
    await expect.element(screen.getByText('Belum ada kejadian.')).toBeVisible();
  });
});
