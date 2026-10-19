// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Unsaved forms ("Simpan draf", FR-T9). The payload is the form state as JSON, encrypted with the user's DEK, so a
 * draft never stores amounts or notes in plain text.
 */
import { decryptText, encrypt } from '@wf/crypto/cipher';
import type { Dek } from '@wf/crypto/envelope';
import { and, desc, eq } from 'drizzle-orm';
import { firstRow, withUser, type Database } from './db.ts';
import { LedgerError } from './ledger-errors.ts';
import { drafts, type JsonObject } from './schema.ts';

/** AAD purpose of `drafts.payload_enc`. */
export const DRAFT_PURPOSE = 'drafts.payload';

export interface DraftView {
  readonly id: string;
  readonly payload: JsonObject;
  readonly updatedAt: Date;
}

export interface DraftInput {
  /** Updates this draft; omitted = a new draft. */
  readonly id?: string;
  /** The form, e.g. `transaction` or `transfer`. */
  readonly kind: string;
  readonly payload: JsonObject;
}

export interface DraftsRepository {
  /** The user's drafts of `kind`, newest first. */
  list: (userId: string, kind: string) => Promise<DraftView[]>;
  /** @throws {LedgerError} `NOT_FOUND` when `input.id` is not one of the user's drafts. */
  save: (userId: string, input: DraftInput) => Promise<{ id: string }>;
  /** @throws {LedgerError} `NOT_FOUND` */
  remove: (userId: string, id: string) => Promise<void>;
}

export function createDrafts(db: Database, { getDek }: { getDek: (userId: string) => Promise<Dek> }): DraftsRepository {
  return {
    list: async (userId, kind) => {
      const rows = await withUser(db, userId, (tx) =>
        tx
          .select({ id: drafts.id, payloadEnc: drafts.payloadEnc, updatedAt: drafts.updatedAt })
          .from(drafts)
          .where(eq(drafts.kind, kind))
          .orderBy(desc(drafts.updatedAt), desc(drafts.id)),
      );
      if (rows.length === 0) return [];
      // Fetched after the transaction: getDek opens its own.
      const dek = await getDek(userId);
      return rows.map((row) => ({
        id: row.id,
        payload: JSON.parse(decryptText(dek, row.payloadEnc, { userId, purpose: DRAFT_PURPOSE })) as JsonObject,
        updatedAt: row.updatedAt,
      }));
    },

    save: async (userId, input) => {
      const dek = await getDek(userId);
      const payloadEnc = encrypt(dek, JSON.stringify(input.payload), { userId, purpose: DRAFT_PURPOSE });
      return withUser(db, userId, async (tx) => {
        if (input.id === undefined) {
          const rows = await tx
            .insert(drafts)
            .values({ userId, kind: input.kind, payloadEnc })
            .returning({ id: drafts.id });
          return firstRow(rows, 'drafts');
        }
        const [row] = await tx
          .update(drafts)
          .set({ kind: input.kind, payloadEnc, updatedAt: new Date() })
          .where(and(eq(drafts.id, input.id), eq(drafts.userId, userId)))
          .returning({ id: drafts.id });
        if (row === undefined) throw new LedgerError('NOT_FOUND', 'No such draft');
        return { id: row.id };
      });
    },

    remove: (userId, id) =>
      withUser(db, userId, async (tx) => {
        const rows = await tx.delete(drafts).where(eq(drafts.id, id)).returning({ id: drafts.id });
        if (rows.length === 0) throw new LedgerError('NOT_FOUND', 'No such draft');
      }),
  };
}
