// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { serveAttachmentFile } from '../../server/attachment-file.ts';
import { Route } from './transactions.$id.attachments.$attachmentId.ts';

vi.mock('../../server/attachment-file.ts', () => ({ serveAttachmentFile: vi.fn() }));

describe('/api/transactions/$id/attachments/$attachmentId', () => {
  it('serves attachment files, GET only', () => {
    expect(Route.options.server?.handlers).toEqual({ GET: serveAttachmentFile });
  });
});
