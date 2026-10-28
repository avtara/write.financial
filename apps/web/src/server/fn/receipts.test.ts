// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { LedgerError } from '@wf/db/ledger-errors';
import { prepareReceipt as realPrepareReceipt } from '@wf/integrations/receipt';
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
  prepareReceipt: vi.fn(),
}));
vi.mock('@tanstack/react-start', async () => (await import('../../../test/server-fn.ts')).serverFnModule());
vi.mock('../runtime.ts', () => ({
  services: () => Promise.resolve({ ...fake, receiptPrepare: fake.prepareReceipt, now: () => NOW }),
}));
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
  // The default is the real pipeline (node has sharp); the UI-facing refusals come from its own validation.
  fake.prepareReceipt.mockImplementation((bytes: Uint8Array, mime: string) => realPrepareReceipt(bytes, mime));
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
  it.each([
    { allowReadFinancial: true, allowCreateDrafts: false },
    { allowReadFinancial: false, allowCreateDrafts: true },
  ])('requires both AI permissions before staging or queueing: %j', async (permissions) => {
    fake.ai.settings.mockResolvedValue(permissions);
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
  it('returns a completed upload on replay without storing or queueing another paid attempt', async () => {
    fake.receipts.get.mockResolvedValue({ id: ID, status: 'attached' });
    expect(await call(uploadReceipt, { context: context(), data: form() })).toMatchObject({
      ok: true,
      value: { status: 'attached' },
    });
    expect(fake.attachmentStore.put).not.toHaveBeenCalled();
    expect(fake.receiptQueue.enqueue).not.toHaveBeenCalled();
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

  it('propagates repository and decoder outages rather than treating them as missing or unreadable receipts', async () => {
    fake.receipts.get.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(call(uploadReceipt, { context: context(), data: form() })).rejects.toThrow('database unavailable');
    fake.prepareReceipt.mockRejectedValueOnce(new Error('native service unavailable'));
    await expect(call(uploadReceipt, { context: context(), data: form() })).rejects.toThrow(
      'native service unavailable',
    );
    expect(fake.attachmentStore.put).not.toHaveBeenCalled();
  });

  it('requires known pricing and includes in-flight reservations in the upload cap', async () => {
    fake.ai.credential.mockResolvedValueOnce({ revision, pricing: null });
    expect(await call(uploadReceipt, { context: context(), data: form() })).toEqual({
      ok: false,
      code: 'AI_PRICING_REQUIRED',
    });
    fake.ai.settings.mockResolvedValueOnce({
      revision,
      provider: 'openrouter',
      allowReadFinancial: true,
      allowCreateDrafts: true,
      usage: { spentUsd: '0', reservedUsd: '5', limitUsd: '5' },
    });
    fake.prepareReceipt.mockResolvedValueOnce({
      bytes: new Uint8Array([1]),
      mime: 'image/webp',
      images: [{ bytes: new Uint8Array([1]), mime: 'image/webp' }],
    });
    expect(await call(uploadReceipt, { context: context(), data: form() })).toEqual({
      ok: false,
      code: 'AI_COST_LIMIT',
    });
    expect(fake.attachmentStore.put).not.toHaveBeenCalled();
    expect(fake.receiptQueue.enqueue).not.toHaveBeenCalled();
  });

  it('preserves staged PDF pages over a queue outage and re-enqueues without uploading them again', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 45]);
    fake.prepareReceipt.mockResolvedValueOnce({
      bytes,
      mime: 'application/pdf',
      images: [
        { bytes: new Uint8Array([1]), mime: 'image/webp' },
        { bytes: new Uint8Array([2]), mime: 'image/webp' },
      ],
    });
    fake.receiptQueue.enqueue.mockRejectedValueOnce(new Error('queue unavailable'));
    const session = fakeSession();
    delete session.user.timezone;
    const data = form(new File([bytes], ' ', { type: 'application/pdf' }));
    await expect(call(uploadReceipt, { context: requestContext(session), data })).rejects.toThrow('queue unavailable');
    expect(fake.receipts.stage.mock.calls[0]?.[1]).toMatchObject({
      payload: { name: 'receipt', timeZone: 'Asia/Jakarta', pages: [{ mime: 'image/webp' }, { mime: 'image/webp' }] },
    });
    expect(fake.attachmentStore.put).toHaveBeenCalledTimes(3);
    expect(fake.attachmentStore.delete).not.toHaveBeenCalled();
    fake.receipts.get.mockResolvedValue({ id: ID, status: 'queued' });
    expect(await call(uploadReceipt, { context: context(), data })).toMatchObject({
      ok: true,
      value: { status: 'queued' },
    });
    expect(fake.attachmentStore.put).toHaveBeenCalledTimes(3);
    expect(await call(getReceipt, { context: context(), data: { id: ID } })).toMatchObject({
      ok: true,
      value: { status: 'queued' },
    });
  });

  it('cleans every redundant PDF object if a concurrent staging attempt wins', async () => {
    fake.prepareReceipt.mockResolvedValueOnce({
      bytes: new Uint8Array([1]),
      mime: 'application/pdf',
      images: [{ bytes: new Uint8Array([2]), mime: 'image/webp' }],
    });
    fake.receipts.stage.mockResolvedValueOnce(false);
    fake.receipts.get
      .mockRejectedValueOnce(new LedgerError('NOT_FOUND'))
      .mockResolvedValueOnce({ id: ID, status: 'reading' });
    expect(await call(uploadReceipt, { context: context(), data: form() })).toMatchObject({
      ok: true,
      value: { status: 'reading' },
    });
    expect(fake.attachmentStore.delete).toHaveBeenCalledTimes(2);
  });

  it('propagates object deletion failure after cancellation and refuses a manual draft on an unavailable account', async () => {
    fake.receipts.cancel.mockResolvedValueOnce(['u/released/original', 'u/released/page']);
    fake.attachmentStore.delete.mockRejectedValueOnce(new Error('object store unavailable'));
    await expect(call(cancelReceipt, { context: context(), data: { id: ID } })).rejects.toThrow(
      'object store unavailable',
    );
    expect(fake.attachmentStore.delete).toHaveBeenCalledTimes(2);
    fake.receipts.manual.mockRejectedValueOnce(new LedgerError('INVALID_ACCOUNT'));
    expect(
      await call(prepareManualReceipt, {
        context: context(),
        data: {
          id: ID,
          accountId: randomUUID(),
          amountMinor: 96500n,
          categoryId: null,
          occurredAt: NOW,
          description: 'Manual correction',
          note: '',
          tags: [],
        },
      }),
    ).toEqual({ ok: false, code: 'INVALID_ACCOUNT' });
  });
});
