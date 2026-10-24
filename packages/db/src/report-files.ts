// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Report export files (FR-LP4, plan §4.6 `report_files`). The bytes of a PDF, XLSX, or CSV export are encrypted with
 * the owner's DEK in object storage (the `reports` bucket, key `u/{userId}/{uuidv7}`); the row keeps only the key, the
 * plaintext size, and the options the export dialog chose, so the saved list ("Laporan tersimpan") can list and
 * re-download an export without regenerating it. Re-exporting the same report and format adds another row.
 *
 * The storage side is a port ({@link ReportFileStore}) so tests can fake it; `@wf/integrations`' `ObjectStore`
 * satisfies it structurally.
 */
import type { ReportExportOptions, ReportFormat } from '@wf/domain/report';
import type { Locale } from '@wf/i18n/locale';
import { and, desc, eq } from 'drizzle-orm';
import { firstRow, withUser, type Database } from './db.ts';
import { LedgerError } from './ledger-errors.ts';
import { reportFiles, users } from './schema.ts';

/** What the repository needs of encrypted object storage; `ObjectStore` over the `reports` bucket satisfies it. */
export interface ReportFileStore {
  /** Encrypts and stores `bytes`; returns the generated key and the plaintext size. */
  put(
    userId: string,
    bytes: Uint8Array,
    mime: string,
  ): Promise<{ readonly key: string; readonly size: number; readonly sha256: string }>;
  /** Fetches and decrypts an object of `userId`. */
  get(userId: string, key: string): Promise<{ readonly bytes: Uint8Array; readonly mime: string }>;
  /** Deletes an object of `userId` (no-op when it does not exist). */
  delete(userId: string, key: string): Promise<void>;
}

/** Media type of each export format; the store authenticates it together with the bytes. */
const MIME: Readonly<Record<ReportFormat, string>> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
};

export interface ReportFileMeta {
  readonly id: string;
  readonly reportId: string;
  readonly format: ReportFormat;
  readonly options: ReportExportOptions;
  readonly fileKey: string;
  /** Plaintext size in bytes (what the saved list shows as "1,2 MB"). */
  readonly sizeBytes: number;
  readonly createdAt: Date;
}

export interface ReportFileContent extends ReportFileMeta {
  readonly bytes: Uint8Array;
  readonly mime: string;
}

/** The export's user context (FR-LP4 auto-send): where the email goes, in which language, in which currency. */
export interface ReportRecipient {
  readonly email: string;
  readonly locale: Locale;
  /** Nickname, else name. */
  readonly name: string | null;
  /** `users.base_currency`, the currency every stored report amount is denominated in. */
  readonly currency: string;
}

export interface ReportFilesRepository {
  /**
   * Stores the bytes in object storage and the meta in Postgres; `now` is the job's clock. The `report_files_report_fk`
   * constraint rejects an unknown report (referential checks bypass RLS, so `wf_worker` needs no grant on `reports`).
   */
  save: (
    userId: string,
    reportId: string,
    format: ReportFormat,
    options: ReportExportOptions,
    bytes: Uint8Array,
    now: Date,
  ) => Promise<ReportFileMeta>;
  /** Newest first. */
  list: (userId: string, options?: { readonly limit?: number }) => Promise<ReportFileMeta[]>;
  /** The stored meta with the decrypted bytes. @throws {LedgerError} `NOT_FOUND` */
  get: (userId: string, id: string) => Promise<ReportFileContent>;
  /** Where the export email goes; `null` when the user is gone (deleted while the job ran). */
  recipient: (userId: string) => Promise<ReportRecipient | null>;
}

export function createReportFiles(db: Database, store: ReportFileStore): ReportFilesRepository {
  return {
    save: (userId, reportId, format, options, bytes, now) =>
      withUser(db, userId, async (tx) => {
        const stored = await store.put(userId, bytes, MIME[format]);
        const rows = await tx
          .insert(reportFiles)
          .values({
            userId,
            reportId,
            format,
            options,
            fileKey: stored.key,
            sizeBytes: stored.size,
            createdAt: now,
          })
          .returning();
        return metaOf(firstRow(rows, 'report_files'));
      }),

    list: (userId, { limit = 24 } = {}) =>
      withUser(db, userId, async (tx) => {
        const rows = await tx
          .select()
          .from(reportFiles)
          .orderBy(desc(reportFiles.createdAt), desc(reportFiles.id))
          .limit(Math.min(Math.max(limit, 1), 100));
        return rows.map(metaOf);
      }),

    get: (userId, id) =>
      withUser(db, userId, async (tx) => {
        const [row] = await tx
          .select()
          .from(reportFiles)
          .where(and(eq(reportFiles.userId, userId), eq(reportFiles.id, id)))
          .limit(1);
        if (row === undefined) throw new LedgerError('NOT_FOUND', 'No such report file');
        const content = await store.get(userId, row.fileKey);
        return { ...metaOf(row), bytes: content.bytes, mime: content.mime };
      }),

    recipient: (userId) =>
      withUser(db, userId, async (tx) => {
        const [row] = await tx
          .select({
            email: users.email,
            locale: users.locale,
            name: users.name,
            nickname: users.nickname,
            currency: users.baseCurrency,
          })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        return row === undefined
          ? null
          : { email: row.email, locale: row.locale, name: row.nickname ?? row.name, currency: row.currency };
      }),
  };
}

const metaOf = (row: typeof reportFiles.$inferSelect): ReportFileMeta => ({
  id: row.id,
  reportId: row.reportId,
  format: row.format,
  options: row.options,
  fileKey: row.fileKey,
  sizeBytes: row.sizeBytes,
  createdAt: row.createdAt,
});
