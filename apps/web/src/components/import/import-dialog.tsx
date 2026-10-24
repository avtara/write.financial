// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The statement import wizard (FR-L9, designs `e56WO`/`Z0eAyw`/`El2vm`): Upload (account, dropzone, "Unduh template
 * CSV") → Review (stat tiles Ditemukan / Akan diimpor / Duplikat / Gagal dibaca, per-row reasons, category guesses)
 * → Done. Parsing happens in the browser (D4 — "File diproses di perangkatmu dan tidak disimpan"); "Impor N
 * transaksi" stores the rows as review items and confirms them through the ordinary review functions, so only the
 * resulting rows ever reach the server.
 */
import { addDays, countDays, type LocalDate } from '@wf/domain/period';
import type { AccountView } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import type { TransactionRow } from '@wf/db/transaction-query';
import { m } from '@wf/i18n/messages';
import type { Locale } from '@wf/i18n/locale';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Sheet } from '@wf/ui/sheet';
import { usePreferences } from '../preferences.tsx';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { MAX_RANGE_DAYS } from '../../lib/transactions-search.ts';
import { requestImport } from '../../server/fn/import.ts';
import { confirmReviewBulk } from '../../server/fn/review.ts';
import { listTransactionRows } from '../../server/fn/transactions.ts';
import {
  buildCandidates,
  isNewCandidate,
  windowOf,
  withCategory,
  type ImportCandidate,
  type ImportCandidates,
  type ImportStage,
} from './import-model.ts';
import {
  fileSize,
  IMPORT_ACCEPT,
  ImportRejectedError,
  importRejectMessage,
  parseStatementFile,
  TEMPLATE_CSV,
} from './import-parse.ts';

/** Most rows the duplicate window and the guessing history ever load. */
const MAX_HISTORY_ROWS = 500;

export type { ImportResult } from './import-model.ts';

export interface ImportDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The user's own accounts: the destination choice, and the transfer detection's name list. */
  readonly accounts: readonly AccountView[];
  readonly categories: readonly CategoryView[];
}

class HistoryError extends Error {
  override name = 'HistoryError';
}

/** The account's transactions in `from`–`to` (ascending), paginated through the existing rows function. */
async function loadWindow(accountId: string, from: LocalDate, to: LocalDate): Promise<TransactionRow[]> {
  const query = { account: accountId, range: `${from}..${to}`, sort: 'date_asc' as const };
  const first = await listTransactionRows({ data: { ...query, offset: 0 } });
  if (!first.ok) throw new HistoryError();
  const rows = [...first.value.rows];
  let offset = rows.length;
  const limit = Math.min(first.value.total, MAX_HISTORY_ROWS);
  while (offset < limit) {
    const next = await listTransactionRows({ data: { ...query, offset } });
    if (!next.ok) throw new HistoryError();
    rows.push(...next.value.rows);
    offset += next.value.rows.length;
  }
  return rows.slice(0, MAX_HISTORY_ROWS);
}

/** The steps of the stepper ("Unggah file → Tinjau transaksi → Selesai"). */
function Stepper({ step }: { step: ImportStage['step'] }) {
  const steps: readonly { readonly key: ImportStage['step']; readonly label: string }[] = [
    { key: 'upload', label: m.import_step_upload() },
    { key: 'review', label: m.import_step_review() },
    { key: 'done', label: m.import_step_done() },
  ];
  return (
    <ol className="flex items-center gap-2 text-[12px]">
      {steps.map((entry, index) => (
        <li
          key={entry.key}
          aria-current={entry.key === step ? 'step' : undefined}
          className={`flex items-center gap-2 ${entry.key === step ? 'font-medium text-fg' : 'text-subtle'}`}
        >
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          {entry.label}
        </li>
      ))}
    </ol>
  );
}

/** One tile of the review's stat row (design `Z0eAyw`). */
function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1 rounded-[10px] border border-border bg-card px-3 py-2">
      <div className="text-[16px] font-semibold text-fg">{value}</div>
      <div className="text-[11.5px] text-subtle">{label}</div>
    </div>
  );
}

const BADGE = 'inline-flex h-5 items-center rounded-full border border-border px-2 text-[11px] text-muted-fg';
const SELECT =
  'h-7 max-w-[180px] rounded-[6px] border border-border-input bg-card px-1.5 text-[12px] text-fg focus-visible:outline-2 focus-visible:outline-ring';

/** One review-table row: a readable candidate or an unreadable row with its reason. */
function CandidateRow({
  candidate,
  currency,
  locale,
  categories,
  onCategoryChange,
}: {
  candidate: ImportCandidate;
  currency: string;
  locale: Locale;
  categories: readonly CategoryView[];
  onCategoryChange: (row: number, categoryId: string | null) => void;
}) {
  if (candidate.status === 'error') {
    return (
      <li className="border-b border-border px-1 py-1.5 text-[12.5px]">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 flex-1 truncate text-muted-fg">
            {candidate.description ?? m.import_status_error()}
          </span>
        </div>
        <p role="alert" className="text-[12px] text-red-fg">
          {candidate.errors.join(' ')}
        </p>
      </li>
    );
  }
  const transfer = candidate.transfer;
  const kind = candidate.direction === 'in' ? 'income' : 'expense';
  const options = categories.filter((category) => category.kind === kind && category.archivedAt === null);
  return (
    <li className="flex items-start gap-3 border-b border-border px-1 py-1.5 text-[12.5px]">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="min-w-0 truncate text-fg">{candidate.description}</span>
          <span className={BADGE}>
            {candidate.status === 'duplicate' ? m.import_status_duplicate() : m.import_status_new()}
          </span>
        </div>
        <div className="text-[11px] text-subtle">
          {formatDate(candidate.date, locale, 'day')}
          {transfer === null ? null : (
            <>
              {' · '}
              {candidate.direction === 'out'
                ? m.import_transfer_to({ name: transfer.displayName })
                : m.import_transfer_from({ name: transfer.displayName })}
            </>
          )}
          {candidate.guessedFrom === null ? null : (
            <>
              {' · '}
              {m.import_guessed()}
            </>
          )}
        </div>
      </div>
      {candidate.status === 'duplicate' || transfer !== null ? (
        <span className="w-[120px]" />
      ) : (
        <select
          value={candidate.categoryId ?? ''}
          aria-label={candidate.description ?? m.import_pick_account()}
          onChange={(event) => {
            onCategoryChange(candidate.row, event.currentTarget.value === '' ? null : event.currentTarget.value);
          }}
          className={SELECT}
        >
          <option value="">{m.import_no_category()}</option>
          {options.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      )}
      <Money
        minor={(candidate.direction === 'out' ? -1n : 1n) * candidate.amountMinor}
        currency={currency}
        context="delta"
        locale={locale}
      />
    </li>
  );
}

export function ImportDialog({ open, onOpenChange, accounts, categories }: ImportDialogProps) {
  const { preferences } = usePreferences();
  const locale = preferences.locale;
  const [stage, setStage] = useState<ImportStage>({ step: 'upload' });
  const [accountId, setAccountId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const templateHref = useMemo(() => URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: 'text/csv' })), []);

  const active = accounts.filter((account) => account.status === 'active');
  const account = active.find((candidate) => candidate.id === accountId) ?? active[0] ?? null;

  /** Closing the wizard throws the next open back to the upload step (the sheet only ever asks to close). */
  const close = (next: boolean) => {
    setStage({ step: 'upload' });
    setAccountId(null);
    setError(null);
    setBusy(false);
    onOpenChange(next);
  };

  /** Parses the file on the device, fetches the duplicate window, and moves to the review step. */
  const handleFile = async (chosen: File) => {
    setError(null);
    if (account === null) {
      setError(m.import_pick_account());
      return;
    }
    setBusy(true);
    try {
      // Type and size rejections carry the design's copy and come from the parser (`ImportRejectedError`).
      const parsed = await parseStatementFile(chosen);
      if (parsed.rows.length === 0) {
        setError(m.import_empty_file());
        return;
      }
      // The window the duplicates come from and the history the categories are guessed from (± 1 day, clamped to
      // the longest range the rows function accepts). Without any readable date there is nothing to fetch.
      const span = windowOf(parsed.rows);
      const rows =
        span === null
          ? []
          : await ((): Promise<TransactionRow[]> => {
              const to = addDays(span.to, 1);
              let from = addDays(span.from, -1);
              if (countDays(from, to) > MAX_RANGE_DAYS) from = addDays(to, -(MAX_RANGE_DAYS - 1));
              return loadWindow(account.id, from, to);
            })();
      setStage({
        step: 'review',
        account,
        statement: parsed,
        candidates: buildCandidates(parsed.rows, {
          accountId: account.id,
          currency: account.currency,
          accounts,
          existing: rows,
          history: [...rows].reverse(),
        }),
      });
    } catch (reason) {
      setError(
        reason instanceof ImportRejectedError
          ? importRejectMessage(reason.reason, reason.fileName, chosen.size)
          : reason instanceof HistoryError
            ? m.import_error_history()
            : m.import_error_read({ name: chosen.name }),
      );
    } finally {
      setBusy(false);
    }
  };

  /** "Impor N transaksi": store the new rows as review items and confirm them in one go. Rows the server already
   * has a proposal for come back as duplicates; empty input is refused by the request validator. */
  const submit = async (destination: AccountView, proposed: ImportCandidates) => {
    const rows = proposed.candidates.filter(isNewCandidate).map((candidate) => ({
      date: candidate.date,
      amountMinor: candidate.amountMinor,
      direction: candidate.direction,
      description: candidate.description,
      categoryId: candidate.categoryId,
      transferAccountId: candidate.transfer === null ? null : candidate.transfer.id,
    }));
    setBusy(true);
    setError(null);
    const stored = await requestImport({ data: { accountId: destination.id, rows } });
    if (!stored.ok) {
      setError(ledgerErrorMessage(stored.code, locale));
      setBusy(false);
      return;
    }
    let failed = 0;
    if (stored.value.itemIds.length > 0) {
      const confirmed = await confirmReviewBulk({ data: { itemIds: [...stored.value.itemIds] } });
      failed = confirmed.ok ? confirmed.value.failed.length : rows.length;
    }
    setStage({
      step: 'done',
      result: { imported: stored.value.created - failed, duplicates: stored.value.duplicates, failed },
    });
    setBusy(false);
  };

  const setCategory = (row: number, categoryId: string | null) => {
    setStage((previous) => withCategory(previous, row, categoryId));
  };

  const uncategorized =
    stage.step === 'review'
      ? stage.candidates.candidates.filter((candidate) => isNewCandidate(candidate) && candidate.categoryId === null)
          .length
      : 0;
  const dropzone = (
    <div
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file !== undefined) void handleFile(file);
      }}
      className="flex flex-col items-center gap-1.5 rounded-[10px] border border-dashed border-border p-6 text-center"
    >
      <FileSpreadsheet aria-hidden="true" className="size-5 text-muted-fg" />
      <span className="text-[13px] text-fg">{m.import_drop()}</span>
      <span className="text-[11.5px] text-subtle">{m.import_file_hint()}</span>
      <button
        type="button"
        disabled={busy || account === null}
        onClick={() => inputRef.current?.click()}
        className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-border px-3 text-[12.5px] text-fg hover:bg-tint-06 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
      >
        <Upload aria-hidden="true" className="size-3.5" />
        {busy ? m.import_reading() : m.import_step_upload()}
      </button>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={IMPORT_ACCEPT}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          if (file !== undefined) void handleFile(file);
        }}
      />
    </div>
  );

  return (
    <Sheet
      open={open}
      onOpenChange={close}
      title={m.import_title()}
      closeLabel={m.import_cancel()}
      size="lg"
      footer={
        stage.step === 'review' ? (
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setStage({ step: 'upload' });
              }}
              className="inline-flex h-8 items-center rounded-[6px] border border-border px-3 text-[13px] text-fg hover:bg-tint-06 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
            >
              {m.import_back()}
            </button>
            <button
              type="button"
              disabled={busy || stage.candidates.stats.toImport === 0}
              onClick={() => {
                void submit(stage.account, stage.candidates);
              }}
              className="inline-flex h-8 items-center rounded-[6px] bg-fg px-3 text-[13px] font-medium text-primary-fg hover:bg-text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
            >
              {m.import_to_import({ count: stage.candidates.stats.toImport })}
            </button>
          </div>
        ) : stage.step === 'done' ? (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                close(false);
              }}
              className="inline-flex h-8 items-center rounded-[6px] bg-fg px-3 text-[13px] font-medium text-primary-fg hover:bg-text-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {m.import_step_done()}
            </button>
          </div>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        <Stepper step={stage.step} />
        {stage.step === 'upload' ? (
          <>
            <section className="flex flex-col gap-1.5">
              <label htmlFor="import-account" className="text-[12.5px] font-medium text-muted-fg">
                {m.import_pick_account()}
              </label>
              <select
                id="import-account"
                value={account?.id ?? ''}
                onChange={(event) => {
                  setAccountId(event.currentTarget.value);
                }}
                className={SELECT}
              >
                {active.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.displayName}
                  </option>
                ))}
              </select>
            </section>
            {dropzone}
            <a
              href={templateHref}
              download="template-impor.csv"
              className="inline-flex items-center gap-1.5 text-[12.5px] text-fg underline decoration-border underline-offset-2 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Download aria-hidden="true" className="size-3.5" />
              {m.import_template()}
            </a>
            <p className="text-[11.5px] text-subtle">{m.import_history_hint()}</p>
            <p className="text-[11.5px] text-subtle">{m.import_privacy()}</p>
            {busy ? <p aria-live="polite">{m.import_reading()}</p> : null}
            {error === null ? null : (
              <p role="alert" className="text-[12px] text-red-fg">
                {error}
              </p>
            )}
          </>
        ) : stage.step === 'review' ? (
          <>
            <p className="text-[12px] text-subtle">
              {stage.statement.name} · {fileSize(stage.statement.size)} ·{' '}
              {m.import_detected({ format: stage.statement.bank ?? m.import_generic() })} → {stage.account.displayName}
            </p>
            <div className="flex gap-2">
              <StatTile label={m.import_stat_found()} value={stage.candidates.stats.found} />
              <StatTile label={m.import_stat_import()} value={stage.candidates.stats.toImport} />
              <StatTile label={m.import_stat_duplicates()} value={stage.candidates.stats.duplicates} />
              <StatTile label={m.import_stat_failed()} value={stage.candidates.stats.unreadable} />
            </div>
            <ul className="flex flex-col">
              {stage.candidates.candidates.map((candidate) => (
                <CandidateRow
                  key={candidate.row}
                  candidate={candidate}
                  currency={stage.account.currency}
                  locale={locale}
                  categories={categories}
                  onCategoryChange={setCategory}
                />
              ))}
            </ul>
            {uncategorized === 0 ? null : (
              <p className="text-[11.5px] text-subtle">{m.import_uncategorized({ count: uncategorized })}</p>
            )}
            <p className="text-[11.5px] text-subtle">{m.import_guessed()}</p>
            {error === null ? null : (
              <p role="alert" className="text-[12px] text-red-fg">
                {error}
              </p>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-2 text-[13px] text-fg">
            <p>{m.import_done_count({ count: stage.result.imported })}</p>
            {stage.result.duplicates === 0 ? null : (
              <p className="text-[12px] text-subtle">{m.import_done_duplicates({ count: stage.result.duplicates })}</p>
            )}
            {stage.result.failed === 0 ? null : (
              <p role="alert" className="text-[12px] text-red-fg">
                {m.import_error_request()}
              </p>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
