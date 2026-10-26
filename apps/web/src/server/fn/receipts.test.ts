// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { LedgerError } from '@wf/db/ledger-errors';
import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession, NOW } from '../../../test/fixtures.ts';
import { call, requestContext } from '../../../test/server-fn.ts';
import { uploadReceipt, getReceipt, cancelReceipt, prepareManualReceipt } from './receipts.ts';
const fake = vi.hoisted(() => ({
  ai: { settings: vi.fn(), credential: vi.fn() },
  receipts: { get: vi.fn(), stage: vi.fn(), cancel: vi.fn(), manual: vi.fn() },
  attachmentStore: { put: vi.fn(), delete: vi.fn() },
  receiptQueue: { enqueue: vi.fn() },
}));
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({ services: () => Promise.resolve({ ...fake, now: () => NOW }) }));
const USER = fakeSession().user.id;
const ID = randomUUID();
const revision = randomUUID();
const context = (twoFactor = true) => requestContext(fakeSession({ twoFactorEnabled: twoFactor }));
const form = (file = new File([new Uint8Array([137, 80, 78, 71])], 'receipt.png', { type: 'image/png' })) => {
  const value = new FormData();
  value.set('id', ID);
  value.set('file', file);
  return value;
};
beforeEach(() => {
  vi.resetAllMocks();
  fake.ai.settings.mockResolvedValue({
    revision,
    provider: 'openrouter',
    allowReadFinancial: true,
    allowCreateDrafts: true,
    usage: { spentUsd: '0', reservedUsd: '0', limitUsd: '5' },
  });
  fake.ai.credential.mockResolvedValue({
    revision,
    pricing: { inputUsdPerMillion: '1', outputUsdPerMillion: '2', requestUsd: '0', imageUsd: '0' },
  });
  fake.receipts.get.mockRejectedValue(new LedgerError('NOT_FOUND'));
  fake.receipts.stage.mockResolvedValue(true);
  fake.attachmentStore.put.mockResolvedValue({ key: `u/${USER}/${randomUUID()}`, size: 8, sha256: 'a'.repeat(64) });
});
describe('receipt API guards', () => {
  it('requires a session and current 2FA before reading settings or accepting bytes', async () => {
    expect(await call(uploadReceipt, { context: requestContext(null), data: form() })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
    expect(await call(uploadReceipt, { context: context(false), data: form() })).toEqual({
      ok: false,
      code: 'TWO_FACTOR_REQUIRED',
    });
    expect(fake.ai.settings).not.toHaveBeenCalled();
  });
  it('requires both AI permissions before staging or queueing', async () => {
    fake.ai.settings.mockResolvedValue({ allowReadFinancial: true, allowCreateDrafts: false });
    expect(await call(uploadReceipt, { context: context(), data: form() })).toEqual({
      ok: false,
      code: 'AI_PERMISSION_REQUIRED',
    });
    expect(fake.receiptQueue.enqueue).not.toHaveBeenCalled();
    expect(fake.attachmentStore.put).not.toHaveBeenCalled();
  });
  it('refuses oversized, unsupported and MIME-spoofed files without storing anything', async () => {
    for (const file of [
      new File([new Uint8Array(2097153)], 'huge.jpg', { type: 'image/jpeg' }),
      new File(['RIFFwebp'], 'r.webp', { type: 'image/webp' }),
      new File(['%PDF-1.4'], 'fake.jpg', { type: 'image/jpeg' }),
    ]) {
      expect(await call(uploadReceipt, { context: context(), data: form(file) })).toMatchObject({
        ok: false,
        code: 'IMAGE_REJECTED',
      });
    }
    expect(fake.receiptQueue.enqueue).not.toHaveBeenCalled();
    expect(fake.attachmentStore.put).not.toHaveBeenCalled();
  });
  it('rejects multiple files rather than silently reading the first receipt', async () => {
    const data = form();
    data.append('file', new File(['another'], 'other.png', { type: 'image/png' }));
    expect(await call(uploadReceipt, { context: context(), data })).toMatchObject({
      ok: false,
      code: 'IMAGE_REJECTED',
    });
    expect(fake.attachmentStore.put).not.toHaveBeenCalled();
    expect(fake.receiptQueue.enqueue).not.toHaveBeenCalled();
  });
  it('re-enqueues a durable queued upload on network replay without another upload or cost', async () => {
    const view = { id: ID, status: 'queued', name: 'private.png' };
    fake.receipts.get.mockResolvedValue(view);
    expect(await call(uploadReceipt, { context: context(), data: form() })).toEqual({ ok: true, value: view });
    expect(fake.attachmentStore.put).not.toHaveBeenCalled();
    expect(fake.receiptQueue.enqueue).toHaveBeenCalledTimes(1);
  });
  it('strips camera metadata before staging and deletes redundant storage if staging fails', async () => {
    const bytes = await sharp({ create: { width: 20, height: 20, channels: 3, background: 'white' } })
      .withMetadata()
      .jpeg()
      .toBuffer();
    fake.receipts.stage.mockRejectedValue(new LedgerError('NOT_FOUND'));
    expect(
      await call(uploadReceipt, {
        context: context(),
        data: form(new File([Uint8Array.from(bytes)], 'receipt.jpg', { type: 'image/jpeg' })),
      }),
    ).toEqual({ ok: false, code: 'NOT_FOUND' });
    const saved = fake.attachmentStore.put.mock.calls[0]?.[1] as Uint8Array;
    expect((await sharp(saved).metadata()).exif).toBeUndefined();
    expect(fake.attachmentStore.delete).toHaveBeenCalledTimes(1);
    expect(fake.receiptQueue.enqueue).not.toHaveBeenCalled();
  });
  it('enforces session ownership for polling, cancellation and manual entry too', async () => {
    const anonymous = requestContext(null);
    expect(await call(getReceipt, { context: anonymous, data: { id: ID } })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
    expect(await call(cancelReceipt, { context: anonymous, data: { id: ID } })).toEqual({
      ok: false,
      code: 'UNAUTHENTICATED',
    });
    expect(
      await call(prepareManualReceipt, {
        context: anonymous,
        data: {
          id: ID,
          accountId: randomUUID(),
          amountMinor: 1n,
          categoryId: null,
          occurredAt: NOW,
          description: '',
          note: '',
          tags: [],
        },
      }),
    ).toEqual({ ok: false, code: 'UNAUTHENTICATED' });
    expect(fake.receipts.manual).not.toHaveBeenCalled();
  });
});
