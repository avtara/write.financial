// SPDX-License-Identifier: AGPL-3.0-only
import { LedgerError } from '@wf/db/ledger-errors';
import { ObjectNotFoundError } from '@wf/integrations/objectstore';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { fakeSession } from '../../test/fixtures.ts';
import { requestContext } from '../../test/server-fn.ts';

const running = vi.hoisted(() => ({ services: null as object | null }));

vi.mock('./runtime.ts', () => ({
  services: () =>
    running.services !== null ? Promise.resolve(running.services) : Promise.reject(new Error('services not started')),
}));

const FILE_ID = '0192a6c4-0000-7000-8000-0000000000f4';
const REPORT_ID = '0192a6c4-0000-7000-8000-0000000000f5';
const PDF_BYTES = new TextEncoder().encode('%PDF-1.7 stored export');

/** The fakes behind the route: the repository answers per `files`, the reports repo per `reports`. */
const fakes = vi.hoisted(() => ({
  files: { get: vi.fn() },
  reports: { get: vi.fn() },
}));

beforeAll(() => {
  running.services = {
    reportFiles: { get: fakes.files.get },
    reports: { get: fakes.reports.get },
  };
});

afterEach(() => {
  fakes.files.get.mockReset();
  fakes.reports.get.mockReset();
});

describe('serveReportFile', () => {
  it('serves the owner’s stored export as an attachment named after its report', async () => {
    const { serveReportFile } = await import('./report-file.ts');
    fakes.files.get.mockResolvedValue({
      id: FILE_ID,
      reportId: REPORT_ID,
      format: 'pdf',
      sizeBytes: PDF_BYTES.length,
      bytes: PDF_BYTES,
      mime: 'application/pdf',
    });
    fakes.reports.get.mockResolvedValue({ id: REPORT_ID, label: '2026-09' });
    const session = fakeSession();
    const response = await serveReportFile({
      context: requestContext(session),
      params: { fileId: FILE_ID },
    });
    expect(response.status).toBe(200);
    expect(fakes.files.get).toHaveBeenCalledWith(session.user.id, FILE_ID);
    expect(fakes.reports.get).toHaveBeenCalledWith(session.user.id, REPORT_ID);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="Laporan-2026-09.pdf"; filename*=UTF-8\'\'Laporan-2026-09.pdf',
    );
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF_BYTES);
  });

  it('answers 404 to a signed-out request and a malformed id, without touching the repositories', async () => {
    const { serveReportFile } = await import('./report-file.ts');
    expect((await serveReportFile({ context: requestContext(null), params: { fileId: FILE_ID } })).status).toBe(404);
    expect((await serveReportFile({ context: requestContext(fakeSession()), params: { fileId: 'nope' } })).status).toBe(
      404,
    );
    expect(fakes.files.get).not.toHaveBeenCalled();
  });

  it('answers 404 to another user’s file, an unknown one, and a missing object', async () => {
    const { serveReportFile } = await import('./report-file.ts');
    const session = fakeSession();
    fakes.files.get.mockRejectedValue(new LedgerError('NOT_FOUND', 'No such report file'));
    expect((await serveReportFile({ context: requestContext(session), params: { fileId: FILE_ID } })).status).toBe(404);
    fakes.files.get.mockRejectedValue(new ObjectNotFoundError('u/u/0'));
    expect((await serveReportFile({ context: requestContext(session), params: { fileId: FILE_ID } })).status).toBe(404);
    // Anything unexpected is a real error, not a 404.
    fakes.files.get.mockRejectedValue(new Error('storage down'));
    await expect(serveReportFile({ context: requestContext(session), params: { fileId: FILE_ID } })).rejects.toThrow(
      'storage down',
    );
  });

  it('answers 404 when the file’s report row answers not found', async () => {
    const { serveReportFile } = await import('./report-file.ts');
    const session = fakeSession();
    fakes.files.get.mockResolvedValue({
      id: FILE_ID,
      reportId: REPORT_ID,
      format: 'csv',
      sizeBytes: 10,
      bytes: new TextEncoder().encode('a,b'),
      mime: 'text/csv',
    });
    fakes.reports.get.mockRejectedValue(new LedgerError('NOT_FOUND', 'gone'));
    expect((await serveReportFile({ context: requestContext(session), params: { fileId: FILE_ID } })).status).toBe(404);
  });
});
