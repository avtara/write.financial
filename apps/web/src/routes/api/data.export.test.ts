// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { serveDataExport } from '../../server/export-file.ts';
import { Route } from './data.export.ts';

vi.mock('../../server/export-file.ts', () => ({ serveDataExport: vi.fn() }));

describe('/api/data/export', () => {
  it("serves the user's data export, GET only", () => {
    expect(Route.options.server?.handlers).toEqual({ GET: serveDataExport });
  });
});
