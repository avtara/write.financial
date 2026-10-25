// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Statement import (FR-L9): the only server function of the import wizard. The browser parses the CSV/XLSX on the
 * device (D4 — the file itself is never uploaded) and sends the parsed, duplicate-marked candidate rows; each valid
 * one becomes a pending review item that the user confirms through the ordinary review confirm functions ("Impor N
 * transaksi" calls `confirmReviewBulk`). The user always comes from the session.
 */
import { createServerFn } from '@tanstack/react-start';
import type { ImportProposalResult } from '@wf/db/import-review';
import type { LocalDate } from '@wf/domain/period';
import * as z from 'zod';
import { attempt, requireSession, type Result } from '../access.ts';
import { services } from '../runtime.ts';

const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((value) => value as LocalDate);

/** One parsed, candidate row of the statement (see `components/import/import-model.ts`). */
const IMPORT_ROW = z.object({
  date: localDate,
  amountMinor: z.bigint().positive(),
  direction: z.enum(['in', 'out']),
  description: z.string().max(200).nullable(),
  categoryId: z.uuid().nullable(),
  transferAccountId: z.uuid().nullable(),
  tags: z.array(z.string().min(1).max(32)).max(5).default([]),
});

/** Module-local: the isolation matrix only tracks `createServerFn` exports (see `import.test.ts` for the schema). */
const IMPORT_INPUT = z.object({
  accountId: z.uuid(),
  rows: z.array(IMPORT_ROW).min(1).max(500),
});

/**
 * FR-L9 "Impor N transaksi", step 1: stores the rows as review items (`import_row` / `system`), skipping rows the
 * account already has a proposal for (idempotent re-import) and counting the ones that fail the server-side check.
 */
export const requestImport = createServerFn({ method: 'POST' })
  .validator(IMPORT_INPUT)
  .handler(async ({ context, data }): Promise<Result<ImportProposalResult>> => {
    const { importReview, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return importReview.propose(user.id, data);
    });
  });
