// SPDX-License-Identifier: AGPL-3.0-only
import { LedgerError } from '@wf/db/ledger-errors';
import { ObjectIntegrityError, ObjectNotFoundError } from '@wf/integrations/objectstore';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../test/fixtures.ts';
import { requestContext } from '../../test/server-fn.ts';
import { serveAttachmentFile } from './attachment-file.ts';

const fake = vi.hoisted(() => ({
  transactions: { get: vi.fn() },
  attachmentStore: { get: vi.fn() },
}));
vi.mock('./runtime.ts', () => ({ services: () => Promise.resolve(fake) }));

const ID = '0192a6c4-0000-7000-8000-0000000000b1';
const ATTACHMENT_ID = '0192a6c4-0000-7000-8000-0000000000a1';
const USER_ID = fakeSession().user.id;
const KEY = `u/${USER_ID}/0192a6c4-0000-7000-8000-0000000000c1`;
const THUMB = `u/${USER_ID}/0192a6c4-0000-7000-8000-0000000000c2`;
const SHA = 'a'.repeat(64);

const attachment = (overrides: object = {}) => ({
  id: ATTACHMENT_ID,
  mime: 'image/webp',
  size: 3,
  kind: 'receipt',
  objectKey: KEY,
  thumbnailKey: THUMB,
  sha256: SHA,
  name: 'struk kopi (1)*.webp',
  createdAt: new Date(),
  ...overrides,
});

const serve = (query = '', params = { id: ID, attachmentId: ATTACHMENT_ID }, context = requestContext()) =>
  serveAttachmentFile({
    context,
    params,
    request: new Request(`http://localhost/api/transactions/${params.id}/attachments/${params.attachmentId}${query}`),
  });

beforeEach(() => {
  vi.clearAllMocks();
  fake.transactions.get.mockResolvedValue({ attachments: [attachment({ id: KEY.slice(-36) }), attachment()] });
  fake.attachmentStore.get.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), mime: 'image/webp' });
});

describe('serveAttachmentFile', () => {
  it('answers the decrypted full file, verified, cacheable, sandboxed, and not sniffable', async () => {
    const response = await serve();
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toEqual({
      'content-type': 'image/webp',
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': 'sandbox',
    });
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect(fake.transactions.get).toHaveBeenCalledWith(USER_ID, ID);
    expect(fake.attachmentStore.get).toHaveBeenCalledWith(USER_ID, KEY, SHA);
  });

  it('serves the thumbnail on ?size=thumbnail, the full file when there is none', async () => {
    await serve('?size=thumbnail');
    expect(fake.attachmentStore.get).toHaveBeenLastCalledWith(USER_ID, THUMB);
    fake.transactions.get.mockResolvedValueOnce({ attachments: [attachment({ thumbnailKey: null })] });
    await serve('?size=thumbnail');
    expect(fake.attachmentStore.get).toHaveBeenLastCalledWith(USER_ID, KEY, SHA);
  });

  it('asks for a download on ?download=1 and always for PDFs', async () => {
    expect((await serve('?download=1')).headers.get('content-disposition')).toBe(
      "attachment; filename*=UTF-8''struk%20kopi%20%281%29%2A.webp",
    );
    fake.transactions.get.mockResolvedValueOnce({ attachments: [attachment({ name: null, thumbnailKey: null })] });
    fake.attachmentStore.get.mockResolvedValueOnce({ bytes: new Uint8Array([0x25]), mime: 'application/pdf' });
    expect((await serve('?size=thumbnail')).headers.get('content-disposition')).toBe('attachment');
    expect((await serve('?download=0')).headers.get('content-disposition')).toBeNull();
  });

  it('answers 404 for bad ids, a signed-out visitor, an unknown transaction or attachment, or a missing object', async () => {
    const responses = [
      await serve('', { id: 'nope', attachmentId: ATTACHMENT_ID }),
      await serve('', { id: ID, attachmentId: 'nope' }),
      await serve('', { id: ID, attachmentId: ATTACHMENT_ID }, requestContext(null)),
    ];
    fake.transactions.get.mockRejectedValueOnce(new LedgerError('NOT_FOUND'));
    responses.push(await serve());
    fake.transactions.get.mockResolvedValueOnce({ attachments: [] });
    responses.push(await serve());
    fake.attachmentStore.get.mockRejectedValueOnce(new ObjectNotFoundError(KEY));
    responses.push(await serve());
    expect(responses.map((response) => [response.status, response.headers.get('cache-control')])).toEqual(
      Array.from({ length: 6 }, () => [404, 'no-store']),
    );
  });

  it('rethrows unexpected failures', async () => {
    fake.transactions.get.mockRejectedValueOnce(new Error('database down'));
    await expect(serve()).rejects.toThrow('database down');
    fake.attachmentStore.get.mockRejectedValueOnce(new ObjectIntegrityError('tampered', KEY));
    await expect(serve()).rejects.toThrow('tampered');
  });
});
