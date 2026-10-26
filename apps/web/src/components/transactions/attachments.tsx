// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A transaction's attachments in the detail panel (FR-L4, design `t7l0Cj` "Struk" and "Gambar lain", `sx3H3` upload
 * errors, `fnn3m` lightbox). The receipt is one image or PDF (a new one replaces it); up to {@link MAX_IMAGES} other
 * images. Files are checked in the browser first (type, 2 MB) and again by the server's image pipeline, which
 * re-encodes images without metadata. Images open in a lightbox (← → to move, Esc to close) with download and delete.
 */
import type { AttachmentView } from '@wf/db/transactions';
import { m } from '@wf/i18n/messages';
import { formatDate, formatTime, toLocalDate } from '@wf/ui/dates';
import { ConfirmDialog } from '@wf/ui/confirm-dialog';
import { ChevronLeft, ChevronRight, Download, FileText, ImagePlus, Maximize2, Trash2, Upload, X } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useRef, useState } from 'react';
import { MAX_IMAGES } from '../../lib/transaction-limits.ts';
import { addAttachment, removeAttachment } from '../../server/fn/transactions.ts';
import { usePreferences } from '../preferences.tsx';

/** 2 MiB, as the server's image pipeline. */
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];

/** The URL of an attachment file (`size: 'thumbnail'`, `download`). */
export function attachmentUrl(
  transactionId: string,
  attachmentId: string,
  options: { readonly thumbnail?: boolean; readonly download?: boolean } = {},
): string {
  const params = new URLSearchParams();
  if (options.thumbnail === true) params.set('size', 'thumbnail');
  if (options.download === true) params.set('download', '1');
  const query = params.toString();
  return `/api/transactions/${transactionId}/attachments/${attachmentId}${query === '' ? '' : `?${query}`}`;
}

/** "248 KB", "1,2 MB". */
export function fileSize(bytes: number, locale: 'id' | 'en'): string {
  const format = new Intl.NumberFormat(locale === 'id' ? 'id-ID' : 'en-US', { maximumFractionDigits: 1 });
  return bytes < 1024 * 1024
    ? `${format.format(Math.max(1, Math.round(bytes / 1024)))} KB`
    : `${format.format(bytes / (1024 * 1024))} MB`;
}

/** "JPG", "PNG", "PDF", … from a media type. */
function typeLabel(mime: string): string {
  const subtype = mime.split('/')[1] ?? mime;
  return (subtype === 'jpeg' ? 'jpg' : subtype).toUpperCase();
}

/** The browser-side check; `null` when the file may be sent. */
export function precheck(file: File, kind: 'receipt' | 'image', locale: 'id' | 'en'): string | null {
  if (!(kind === 'receipt' ? RECEIPT_TYPES : IMAGE_TYPES).includes(file.type)) {
    return m.transactions_attachment_error_type({ name: file.name });
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return m.transactions_attachment_error_size({ name: file.name, size: fileSize(file.size, locale) });
  }
  return null;
}

/** The message for a refused upload (`IMAGE_REJECTED` reasons, `ATTACHMENT_LIMIT`). */
export function uploadError(code: string, detail: string | undefined, name: string): string {
  if (code === 'ATTACHMENT_LIMIT') return m.transactions_attachment_error_limit({ count: MAX_IMAGES });
  if (code === 'IMAGE_REJECTED') {
    if (detail === 'too-large') return m.transactions_attachment_error_size({ name, size: '> 2 MB' });
    if (detail === 'unsupported-type') return m.transactions_attachment_error_type({ name });
    return m.transactions_attachment_error_corrupt({ name });
  }
  return m.transactions_attachment_error_failed({ name });
}

export interface AttachmentsProps {
  readonly transactionId: string;
  readonly attachments: readonly AttachmentView[];
  /** Read-only (a deleted transaction). */
  readonly readOnly: boolean;
  readonly label: string;
  readonly timeZone: string;
  /** After an upload or a delete. */
  readonly onChanged: () => void;
}

export function Attachments({ transactionId, attachments, readOnly, label, timeZone, onChanged }: AttachmentsProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const receiptInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'receipt' | 'image' | null>(null);
  const [error, setError] = useState<{ kind: 'receipt' | 'image'; message: string } | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const receipt = attachments.find((attachment) => attachment.kind === 'receipt');
  const images = attachments.filter((attachment) => attachment.kind !== 'receipt');
  const viewable = attachments.filter((attachment) => attachment.mime.startsWith('image/'));

  const upload = async (file: File, kind: 'receipt' | 'image') => {
    const refused = precheck(file, kind, locale);
    if (refused !== null) {
      setError({ kind, message: refused });
      return;
    }
    setBusy(kind);
    setError(null);
    const data = new FormData();
    data.set('transactionId', transactionId);
    data.set('kind', kind);
    data.set('file', file);
    const result = await addAttachment({ data });
    setBusy(null);
    if (!result.ok) {
      setError({ kind, message: uploadError(result.code, result.detail, file.name) });
      return;
    }
    onChanged();
  };

  const picker = (kind: 'receipt' | 'image') => (
    <input
      ref={kind === 'receipt' ? receiptInput : imageInput}
      type="file"
      hidden
      accept={(kind === 'receipt' ? RECEIPT_TYPES : IMAGE_TYPES).join(',')}
      onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (file !== undefined) void upload(file, kind);
      }}
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby={`${transactionId}-receipt`} className="flex flex-col gap-2">
        <h3 id={`${transactionId}-receipt`} className="text-[12.5px] font-medium text-muted-fg">
          {m.transactions_attachment_receipt()}
        </h3>
        <div
          onDragOver={(event) => {
            if (!readOnly) event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            const file = event.dataTransfer.files[0];
            if (!readOnly && file !== undefined) void upload(file, 'receipt');
          }}
          className="flex items-center gap-3 rounded-[10px] border border-border p-2.5"
        >
          {receipt === undefined ? (
            <span className="flex-1 text-[12.5px] text-subtle">{m.transactions_attachment_receipt_none()}</span>
          ) : (
            <>
              {receipt.mime.startsWith('image/') ? (
                <button
                  type="button"
                  aria-label={m.transactions_attachment_open({ name: receipt.name ?? typeLabel(receipt.mime) })}
                  onClick={() => {
                    setViewing(viewable.indexOf(receipt));
                  }}
                  className="size-10 shrink-0 overflow-hidden rounded-[6px] border border-border focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <img
                    src={attachmentUrl(transactionId, receipt.id, { thumbnail: true })}
                    alt=""
                    className="size-full object-cover"
                  />
                </button>
              ) : (
                <span className="flex size-10 shrink-0 items-center justify-center rounded-[6px] border border-border text-muted-fg">
                  <FileText aria-hidden="true" className="size-4" />
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] text-fg">{receipt.name ?? typeLabel(receipt.mime)}</span>
                <span className="text-[11.5px] text-subtle">
                  {fileSize(receipt.size, locale)} · {typeLabel(receipt.mime)}
                </span>
              </span>
              <a
                href={attachmentUrl(transactionId, receipt.id, { download: true })}
                aria-label={m.transactions_attachment_download()}
                className="flex size-7 items-center justify-center rounded-[6px] text-subtle hover:bg-tint-06 hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Download aria-hidden="true" className="size-3.5" />
              </a>
            </>
          )}
          {readOnly ? null : (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => receiptInput.current?.click()}
              className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-border px-2 text-[12px] text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
            >
              <Upload aria-hidden="true" className="size-3.5" />
              {busy === 'receipt'
                ? m.transactions_attachment_uploading()
                : receipt === undefined
                  ? m.transactions_attachment_upload()
                  : m.transactions_attachment_replace()}
            </button>
          )}
          {picker('receipt')}
        </div>
        {error?.kind === 'receipt' ? (
          <p role="alert" className="text-[12px] text-red-fg">
            {error.message} {receipt === undefined ? null : m.transactions_attachment_receipt_kept()}
          </p>
        ) : null}
      </section>
      <section aria-labelledby={`${transactionId}-images`} className="flex flex-col gap-2">
        <h3
          id={`${transactionId}-images`}
          className="flex items-baseline justify-between text-[12.5px] font-medium text-muted-fg"
        >
          {m.transactions_attachment_images()}
          <span className="font-mono text-[11px] font-normal text-subtle">
            {m.transactions_attachment_images_count({ count: images.length, max: MAX_IMAGES })}
          </span>
        </h3>
        <ul className="grid grid-cols-3 gap-2">
          {images.map((image) => (
            <li key={image.id}>
              <button
                type="button"
                aria-label={m.transactions_attachment_open({ name: image.name ?? typeLabel(image.mime) })}
                onClick={() => {
                  setViewing(viewable.indexOf(image));
                }}
                className="group relative block aspect-[4/3] w-full overflow-hidden rounded-[8px] border border-border focus-visible:outline-2 focus-visible:outline-ring"
              >
                <img
                  src={attachmentUrl(transactionId, image.id, { thumbnail: true })}
                  alt=""
                  className="size-full object-cover"
                />
                <Maximize2
                  aria-hidden="true"
                  className="absolute top-1.5 right-1.5 size-5 rounded-[4px] bg-scrim p-1 text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                />
              </button>
            </li>
          ))}
          {readOnly || images.length >= MAX_IMAGES ? null : (
            <li>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => imageInput.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const file = event.dataTransfer.files[0];
                  if (file !== undefined) void upload(file, 'image');
                }}
                className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 rounded-[8px] border border-dashed border-border text-[11.5px] text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60"
              >
                <ImagePlus aria-hidden="true" className="size-4" />
                {busy === 'image' ? m.transactions_attachment_uploading() : m.transactions_attachment_add()}
                <span className="text-[10.5px] text-subtle">{m.transactions_attachment_add_hint()}</span>
              </button>
              {picker('image')}
            </li>
          )}
        </ul>
        {error?.kind === 'image' ? (
          <p role="alert" className="text-[12px] text-red-fg">
            {error.message}
          </p>
        ) : null}
      </section>
      {viewing === null || viewable[viewing] === undefined ? null : (
        <Lightbox
          transactionId={transactionId}
          attachments={viewable}
          index={viewing}
          label={label}
          timeZone={timeZone}
          readOnly={readOnly}
          onIndexChange={setViewing}
          onClose={() => {
            setViewing(null);
          }}
          onDeleted={() => {
            setViewing(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

export interface LightboxProps {
  readonly transactionId: string;
  readonly attachments: readonly AttachmentView[];
  readonly index: number;
  readonly label: string;
  readonly timeZone: string;
  readonly readOnly: boolean;
  readonly onIndexChange: (index: number) => void;
  readonly onClose: () => void;
  readonly onDeleted: () => void;
}

const LIGHTBOX_BUTTON =
  'inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-border px-3 text-[12.5px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring';

/** "Lihat lampiran" (`fnn3m`): one image at a time, ← → to move, Esc to close, download and delete. */
export function Lightbox({
  transactionId,
  attachments,
  index,
  label,
  timeZone,
  readOnly,
  onIndexChange,
  onClose,
  onDeleted,
}: LightboxProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState(false);
  const current = attachments[index];
  if (current === undefined) return null;
  const move = (step: number) => {
    onIndexChange((index + step + attachments.length) % attachments.length);
  };
  return (
    // Always open, so a change can only be a close.
    <Dialog.Root open onOpenChange={onClose}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <Dialog.Content
          aria-describedby={undefined}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') move(-1);
            if (event.key === 'ArrowRight') move(1);
          }}
          className="fixed inset-4 z-50 flex flex-col gap-3 rounded-[14px] border border-border-dialog bg-dialog p-4 text-fg"
        >
          <div className="flex items-center gap-3">
            <div className="flex min-w-0 flex-1 flex-col">
              <Dialog.Title className="truncate text-[14px] font-semibold">{label}</Dialog.Title>
              <p className="text-[12px] text-subtle">
                {fileSize(current.size, locale)} · {typeLabel(current.mime)} ·{' '}
                {m.transactions_attachment_uploaded({
                  date: `${formatDate(toLocalDate(current.createdAt, timeZone), locale, 'day')}, ${formatTime(current.createdAt, timeZone, locale)}`,
                })}
              </p>
            </div>
            <a href={attachmentUrl(transactionId, current.id, { download: true })} className={LIGHTBOX_BUTTON}>
              <Download aria-hidden="true" className="size-3.5" />
              {m.transactions_attachment_download()}
            </a>
            {readOnly ? null : (
              <button
                type="button"
                className={LIGHTBOX_BUTTON}
                onClick={() => {
                  setConfirming(true);
                }}
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
                {m.transactions_attachment_delete()}
              </button>
            )}
            <Dialog.Close
              aria-label={m.transactions_detail_close()}
              className="flex size-8 items-center justify-center rounded-[7px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X aria-hidden="true" className="size-4" />
            </Dialog.Close>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center">
            <img
              src={attachmentUrl(transactionId, current.id)}
              alt={m.transactions_attachment_image({ index: index + 1 })}
              className="max-h-full max-w-full rounded-[8px] object-contain"
            />
            {attachments.length < 2 ? null : (
              <>
                <button
                  type="button"
                  aria-label={m.transactions_attachment_previous()}
                  onClick={() => {
                    move(-1);
                  }}
                  className="absolute left-2 flex size-9 items-center justify-center rounded-full bg-card text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <ChevronLeft aria-hidden="true" className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label={m.transactions_attachment_next()}
                  onClick={() => {
                    move(1);
                  }}
                  className="absolute right-2 flex size-9 items-center justify-center rounded-full bg-card text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <ChevronRight aria-hidden="true" className="size-4" />
                </button>
              </>
            )}
          </div>
          <div className="flex items-center justify-between text-[11.5px] text-subtle">
            <span>{m.transactions_attachment_hint()}</span>
            <span className="font-mono" aria-live="polite">
              {index + 1} / {attachments.length}
            </span>
          </div>
          {failed ? (
            <p role="alert" className="text-[12px] text-red-fg">
              {m.transactions_attachment_delete_failed()}
            </p>
          ) : null}
          <ConfirmDialog
            open={confirming}
            onOpenChange={setConfirming}
            title={m.transactions_attachment_delete_title()}
            description={m.transactions_attachment_delete_description()}
            confirmLabel={m.transactions_attachment_delete()}
            cancelLabel={m.record_cancel()}
            variant="destructive"
            onConfirm={() => {
              void removeAttachment({ data: { id: current.id } }).then((result) => {
                if (result.ok) onDeleted();
                else setFailed(true);
              });
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
