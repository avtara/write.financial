// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { TODAY } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { PriceSyncStatus } from './price-sync.tsx';
const fake = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock('../../server/fn/market.ts', () => ({ getMarketApiLog: fake.log }));

describe('PriceSyncStatus', () => {
  it('distinguishes a partial result, unavailable source, and the in-flight source', async () => {
    const { screen } = await renderApp(<PriceSyncStatus today={TODAY} timeZone="Asia/Jakarta" locale="id" state={{ current: 'crypto', results: [
      { market: 'us_equity', status: 'partial', synced: 2, missing: 1, provider: 'tiingo', pausedUntil: null },
      { market: 'idx_equity', status: 'no_key', synced: 0, missing: 3, provider: null, pausedUntil: null },
    ] }} />);
    const status = screen.getByRole('status');
    await expect.element(status).toHaveTextContent('2 diperbarui, 1 memakai harga terakhir');
    await expect.element(status).toHaveTextContent('Tanpa key — memakai harga manual atau terakhir');
    await expect.element(status).toHaveTextContent('Sinkron 3/4…');
  });
  it('explains a failed API log request and permits a real retry', async () => {
    fake.log.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true, value: [] });
    const { screen } = await renderApp(<PriceSyncStatus today={TODAY} timeZone="Asia/Jakarta" locale="id" state={null} />);
    await screen.getByRole('button', { name: 'Buka log API' }).click();
    await expect.element(screen.getByRole('alert')).toHaveTextContent('Log tidak dapat dimuat');
    await screen.getByRole('button', { name: 'Buka log API' }).click();
    await expect.element(screen.getByRole('dialog', { name: 'Log permintaan' })).toHaveTextContent('Belum ada permintaan.');
  });
});
