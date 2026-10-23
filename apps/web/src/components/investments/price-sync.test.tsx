// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { TODAY } from '../../../test/investment-fixtures.ts';
import { renderApp } from '../../../test/render.tsx';
import { PriceSyncStatus } from './price-sync.tsx';
const fake = vi.hoisted(() => ({ log: vi.fn() }));
// The sync panel reuses Settings › "API kurs & pasar"'s ApiLog/syncText, so its module's other server functions load too.
vi.mock('../../server/fn/market.ts', () => ({
  getMarketApiLog: fake.log,
  removeMarketKey: vi.fn(),
  saveMarketKey: vi.fn(),
  setMarketKeyActive: vi.fn(),
  syncMarketSource: vi.fn(),
  testMarketKey: vi.fn(),
}));

describe('PriceSyncStatus', () => {
  it('distinguishes a partial result, unavailable source, and the in-flight source', async () => {
    const { screen } = await renderApp(
      <PriceSyncStatus
        today={TODAY}
        timeZone="Asia/Jakarta"
        locale="id"
        state={{
          current: 'crypto',
          results: [
            { market: 'us_equity', status: 'partial', synced: 2, missing: 1, provider: 'tiingo', pausedUntil: null },
            { market: 'idx_equity', status: 'no_key', synced: 0, missing: 3, provider: null, pausedUntil: null },
          ],
        }}
      />,
    );
    const status = screen.getByRole('status');
    await expect.element(status).toMatchTextContent('2 diperbarui, 1 memakai harga terakhir');
    await expect.element(status).toMatchTextContent('Tanpa key — memakai harga manual atau terakhir');
    await expect.element(status).toMatchTextContent('Sinkron 3/4…');
  });

  it('shows only the finished results once no source is in flight', async () => {
    const { screen } = await renderApp(
      <PriceSyncStatus today={TODAY} timeZone="Asia/Jakarta" locale="id" state={{ current: null, results: [] }} />,
    );
    await expect.element(screen.getByRole('status')).toBeVisible();
  });

  it('explains a failed API log request and permits a real retry', async () => {
    const entry = {
      id: 'log-1',
      provider: 'tiingo' as const,
      endpoint: 'GET /quote/SPY',
      httpStatus: 200,
      ok: true,
      durationMs: 12,
      retry: null,
      errorCode: null,
      at: new Date(),
      own: true,
    };
    fake.log.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true, value: [entry] });
    const { screen } = await renderApp(
      <PriceSyncStatus today={TODAY} timeZone="Asia/Jakarta" locale="id" state={null} />,
    );
    await screen.getByRole('button', { name: 'Buka log API' }).click();
    await expect.element(screen.getByRole('alert')).toMatchTextContent('Log tidak dapat dimuat');
    await screen.getByRole('button', { name: 'Buka log API' }).click();
    const log = screen.getByRole('dialog', { name: 'Log permintaan' });
    await expect.element(log).toMatchTextContent('Tiingo');
    await expect.element(log).toMatchTextContent('GET /quote/SPY');
    await userEvent.keyboard('{Escape}');
    await expect.element(log).not.toBeInTheDocument();
  });

  it('opens Settings › API kurs & pasar from the panel', async () => {
    const { screen, router } = await renderApp(
      <PriceSyncStatus today={TODAY} timeZone="Asia/Jakarta" locale="id" state={null} />,
    );
    await screen.getByRole('button', { name: 'Atur API harga' }).click();
    await expect.poll(() => router.state.location.search as unknown).toMatchObject({ settings: 'market' });
  });
});
