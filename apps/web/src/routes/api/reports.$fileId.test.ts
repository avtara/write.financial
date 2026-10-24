// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { serveReportFile } from '../../server/report-file.ts';
import { Route } from './reports.$fileId.ts';

vi.mock('../../server/report-file.ts', () => ({ serveReportFile: vi.fn() }));

describe('/api/reports/$fileId', () => {
  it('serves stored report exports, GET only', () => {
    expect(Route.options.server?.handlers).toEqual({ GET: serveReportFile });
  });
});
