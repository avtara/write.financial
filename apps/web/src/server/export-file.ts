// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `GET /api/data/export?format=json|csv` (FR-A11, FR-ST5): the signed-in user's data as a download — every
 * exported table as JSON, or the main ledger (transactions with account, category, and tag names) as CSV.
 * Exporting requires 2FA (FR-A9); a signed-out request answers 401 and an unverified one 403, both as a small
 * JSON body instead of a file. The response is an attachment (`Content-Disposition`), never cached, cannot run
 * script or be embedded (`nosniff`, CSP `sandbox`, CORP).
 */
import { UnauthenticatedError, TwoFactorRequiredError } from '@wf/auth/session';
import { transactionsCsv } from '@wf/db/export';
import { downloadHeaders } from '@wf/integrations/download';
import { requireSession } from './access.ts';
import type { RequestContext } from './request-middleware.ts';
import { services } from './runtime.ts';

export type ExportFormat = 'json' | 'csv';

/** Builds the export payload: the JSON document of every table and the CSV of the main ledger. */
export async function buildExport(userId: string): Promise<{ exportedAt: Date; json: string; csv: string }> {
  const { export: exporter } = await services();
  const data = await exporter.collect(userId);
  return {
    exportedAt: data.exportedAt,
    json: JSON.stringify(
      data,
      // `jsonb` has no bigint: amounts travel as decimal strings, dates as ISO.
      (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value),
      2,
    ),
    csv: transactionsCsv(await exporter.ledgerRows(userId)),
  };
}

const REFUSED = (status: number, code: string) =>
  Response.json({ ok: false, code }, { status, headers: { 'Cache-Control': 'no-store' } });

/** Serves one file of {@link buildExport}; `?format=` (default `json`) picks which. */
export async function serveDataExport({
  context,
  request,
}: {
  context: Pick<RequestContext, 'session'>;
  request: Request;
}): Promise<Response> {
  let userId: string;
  try {
    const { now } = await services();
    const session = await requireSession(context.session, { twoFactor: true }, now());
    userId = session.user.id;
  } catch (error) {
    if (error instanceof UnauthenticatedError) return REFUSED(401, 'UNAUTHENTICATED');
    if (error instanceof TwoFactorRequiredError) return REFUSED(403, 'TWO_FACTOR_REQUIRED');
    throw error;
  }
  const format: ExportFormat = new URL(request.url).searchParams.get('format') === 'csv' ? 'csv' : 'json';
  const { exportedAt, json, csv } = await buildExport(userId);
  const filename = `write-financial-export-${exportedAt.toISOString().slice(0, 10)}.${format}`;
  return new Response(format === 'csv' ? csv : json, {
    headers: new Headers({ ...downloadHeaders(format === 'csv' ? 'text/csv' : 'application/json', filename) }),
  });
}
