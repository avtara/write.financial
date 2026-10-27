// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { serveGmailLog } from '../../server/gmail-log-file.ts';
import { Route } from './gmail.log.ts';

vi.mock('../../server/gmail-log-file.ts', () => ({ serveGmailLog: vi.fn() }));

describe('/api/gmail/log', () => {
  it("serves the user's email ingest log as a download, GET only", () => {
    expect(Route.options.server?.handlers).toEqual({ GET: serveGmailLog });
  });
});
