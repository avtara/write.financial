// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import type { Enqueue } from './enqueue.ts';
import { FX_TIME_ZONE, requestFxRefresh } from './fx.ts';

describe('requestFxRefresh', () => {
  it('enqueues the fx job once per Jakarta day', async () => {
    const enqueue = vi.fn<Enqueue>(() => Promise.resolve());
    // 16:59 UTC on 18 Oct is 23:59 WIB on 18 Oct; 17:00 UTC is already 19 Oct in Jakarta.
    expect(await requestFxRefresh(enqueue, new Date('2026-10-18T16:59:00Z'))).toBe('fx.2026-10-18');
    expect(await requestFxRefresh(enqueue, new Date('2026-10-18T17:00:00Z'))).toBe('fx.2026-10-19');
    expect(enqueue.mock.calls).toEqual([
      ['fx', {}, { jobId: 'fx.2026-10-18' }],
      ['fx', {}, { jobId: 'fx.2026-10-19' }],
    ]);
    expect(FX_TIME_ZONE).toBe('Asia/Jakarta');
  });

  it('propagates enqueue failures', async () => {
    const enqueue = vi.fn<Enqueue>(() => Promise.reject(new Error('ECONNREFUSED')));
    await expect(requestFxRefresh(enqueue, new Date('2026-10-19T03:00:00Z'))).rejects.toThrow('ECONNREFUSED');
  });
});
