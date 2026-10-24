// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Isolation cases for the server functions in `src/server/fn/report-export.ts`, run by
 * `src/server/fn/isolation.integration.test.ts`. B can queue an export only of B's own report (A's is
 * `NOT_FOUND`, and nothing is enqueued for it), lists only B's own files, and keeps the auto-send toggle per
 * user; the queued job really lands in Valkey's `report-export` queue, which the case drains.
 */
import type { LocalDate } from '@wf/domain/period';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { expect } from 'vitest';
import type { Result } from '../../../src/server/access.ts';
import {
  as,
  aId,
  bId,
  type Case,
  type Name,
  NOT_FOUND,
  ok,
  services,
  SOME_ID,
  UNAUTHENTICATED,
  valkeyUrl,
} from '../harness.ts';

const OPTIONS = { sections: ['summary', 'flow'], theme: 'light', paper: 'a4', maskAccountNumbers: false } as const;

/** A report of `userId`'s own, generated through the repository as the page would have stored it. */
async function reportOf(userId: string): Promise<string> {
  return services.reports
    .generate(userId, { kind: 'custom', from: '2026-10-02' as LocalDate, to: '2026-10-07' as LocalDate }, new Date())
    .then((view: { readonly id: string }) => view.id);
}

/** The number of `report-export` jobs waiting in Valkey, then the queue drained. */
async function drainQueue(): Promise<number> {
  const connection = new Redis(valkeyUrl, { maxRetriesPerRequest: null });
  try {
    const queue = new Queue('report-export', { connection, prefix: 'wf' });
    const waiting = await queue.getJobCountByTypes('waiting', 'delayed');
    await queue.obliterate({ force: true });
    return waiting;
  } finally {
    await connection.quit();
  }
}

export const cases = {
  requestReportExport: {
    input: () => ({ reportId: SOME_ID, format: 'pdf', options: OPTIONS }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      // B's own report: the job lands in Valkey with B's id, no email (a manual export is a download).
      const bReport = await reportOf(bId);
      expect(
        await as<Result<object>>('B', 'requestReportExport', { reportId: bReport, format: 'pdf', options: OPTIONS }),
      ).toEqual(ok({}));
      expect(await drainQueue()).toBe(1);
      // A's report (and an unknown one) is refused before anything is queued.
      const aReport = await reportOf(aId);
      expect(await as('B', 'requestReportExport', { reportId: aReport, format: 'pdf', options: OPTIONS })).toEqual(
        NOT_FOUND,
      );
      expect(await as('B', 'requestReportExport', input)).toEqual(NOT_FOUND);
      expect(await drainQueue()).toBe(0);
    },
  },
  listReportFiles: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      // Neither user has stored a file through these functions here, so B's list is empty and never A's.
      expect(await as<Result<unknown[]>>('B', 'listReportFiles', {})).toEqual(ok([]));
    },
  },
  getReportAutoSend: {
    input: () => ({}),
    anonymous: () => UNAUTHENTICATED,
    asB: async () => {
      expect(await as<Result<boolean>>('B', 'getReportAutoSend', {})).toEqual(ok(false));
    },
  },
  saveReportAutoSend: {
    input: () => ({ enabled: true }),
    anonymous: () => UNAUTHENTICATED,
    asB: async (input) => {
      // B switches the toggle on and reads it back; A's preference stays off.
      expect(await as<Result<boolean>>('B', 'saveReportAutoSend', input)).toEqual(ok(true));
      expect(await as<Result<boolean>>('B', 'getReportAutoSend', {})).toEqual(ok(true));
      expect(await services.preferences.get(aId)).toMatchObject({ reportAutoSend: false });
      // Switching it back off leaves the row in place.
      expect(await as('B', 'saveReportAutoSend', { enabled: false })).toEqual(ok(false));
    },
  },
} satisfies Partial<Record<Name, Case>>;
