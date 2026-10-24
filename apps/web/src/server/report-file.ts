// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /api/reports/$fileId` (FR-LP4): the signed-in user's stored export, decrypted from the reports bucket and
 * always served as an attachment named after its report ("Laporan-2026-09.pdf"). Another user's file, an unknown
 * id, and signed-out requests all answer 404, so the response never reveals whether an id exists. The bytes are a
 * rendered artifact (script-free by construction), but the download headers keep even a hostile file inert.
 */
import { LedgerError } from '@wf/db/ledger-errors';
import { downloadHeaders } from '@wf/integrations/download';
import { ObjectNotFoundError } from '@wf/integrations/objectstore';
import * as z from 'zod';
import { exportFileName } from './fn/report-export.ts';
import type { RequestContext } from './request-middleware.ts';
import { services } from './runtime.ts';

const NOT_FOUND = () => new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });

export async function serveReportFile({
  context,
  params,
}: {
  context: Pick<RequestContext, 'session'>;
  params: { fileId: string };
}): Promise<Response> {
  const id = z.uuid().safeParse(params.fileId);
  const session = await context.session();
  if (!id.success || session === null) return NOT_FOUND();
  const all = await services();
  try {
    const content = await all.reportFiles.get(session.user.id, id.data);
    // The file's report exists (its foreign key cascades), so the label is always in hand; a missing object or a
    // half-deleted row answers 404 like any other refusal.
    const report = await all.reports.get(session.user.id, content.reportId);
    // A copy backed by a plain `ArrayBuffer`, as `Response` takes.
    return new Response(content.bytes.slice(), {
      headers: { ...downloadHeaders(content.mime, exportFileName(report.label, content.format)) },
    });
  } catch (error) {
    if (error instanceof LedgerError || error instanceof ObjectNotFoundError) return NOT_FOUND();
    throw error;
  }
}
