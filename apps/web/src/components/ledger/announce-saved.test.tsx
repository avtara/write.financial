// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@wf/i18n/runtime';
import { announceSaved } from './announce-saved.tsx';

const toast = vi.hoisted(() => ({ undo: vi.fn(), toast: vi.fn() }));
vi.mock('@wf/ui/toast', () => ({ toast: Object.assign(toast.toast, { undo: toast.undo }) }));
vi.mock('../../server/fn/transactions-write.ts', () => ({ removeTransactions: vi.fn() }));
const { removeTransactions } = (await import('../../server/fn/transactions-write.ts')) as unknown as {
  removeTransactions: ReturnType<typeof vi.fn>;
};

describe('announceSaved', () => {
  beforeEach(async () => {
    // The toast copy reads the ambient paraglide locale; pin it instead of the browser's default.
    await setLocale('id', { reload: false });
    vi.clearAllMocks();
  });

  it('undoes the saved transaction from the toast and reports the failure honestly', async () => {
    announceSaved({
      id: 't1',
      label: 'Makan siang',
      amountMinor: -45_000n,
      currency: 'IDR',
      accountName: 'GoPay',
      locale: 'id',
      onChange: () => undefined,
    });
    expect(toast.undo).toHaveBeenCalledTimes(1);
    const options = toast.undo.mock.calls[0]?.[0] as { onUndo: () => Promise<void>; undoLabel: string };
    expect(options.undoLabel).toBe('Urungkan');

    removeTransactions.mockResolvedValueOnce({ ok: false, code: 'NOT_FOUND' });
    await options.onUndo();
    expect(toast.toast).toHaveBeenLastCalledWith(expect.objectContaining({ tone: 'error' }));

    removeTransactions.mockResolvedValueOnce({ ok: true, value: null });
    await options.onUndo();
    expect(toast.toast).toHaveBeenLastCalledWith(expect.objectContaining({ tone: 'info' }));
  });
});
