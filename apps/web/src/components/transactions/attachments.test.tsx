// SPDX-License-Identifier: AGPL-3.0-only
import type { AttachmentView } from '@wf/db/transactions';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { renderApp } from '../../../test/render.tsx';
import { RECEIPT } from '../../../test/transaction-fixtures.ts';
import {
  attachmentUrl,
  Attachments,
  type AttachmentsProps,
  fileSize,
  Lightbox,
  MAX_ATTACHMENT_BYTES,
  precheck,
  uploadError,
} from './attachments.tsx';

const server = vi.hoisted(() => ({ addAttachment: vi.fn(), removeAttachment: vi.fn() }));
vi.mock('../../server/fn/transactions.ts', () => server);

const image = (id: string, patch: Partial<AttachmentView> = {}): AttachmentView => ({
  ...RECEIPT,
  id,
  kind: 'image',
  mime: 'image/png',
  name: `${id}.png`,
  ...patch,
});
const file = (name: string, type: string, size = 10) => new File([new Uint8Array(size)], name, { type });

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('helpers', () => {
  it('builds file URLs', () => {
    expect(attachmentUrl('t', 'a')).toBe('/api/transactions/t/attachments/a');
    expect(attachmentUrl('t', 'a', { thumbnail: true })).toBe('/api/transactions/t/attachments/a?size=thumbnail');
    expect(attachmentUrl('t', 'a', { download: true, thumbnail: false })).toBe(
      '/api/transactions/t/attachments/a?download=1',
    );
  });

  it('sizes files in KB and MB per locale', () => {
    expect(fileSize(10, 'id')).toBe('1 KB');
    expect(fileSize(248 * 1024, 'en')).toBe('248 KB');
    expect(fileSize(1.25 * 1024 * 1024, 'id')).toBe('1,3 MB');
    expect(fileSize(1.25 * 1024 * 1024, 'en')).toBe('1.3 MB');
  });

  it('checks type and size before uploading', () => {
    expect(precheck(file('a.pdf', 'application/pdf'), 'receipt', 'id')).toBeNull();
    expect(precheck(file('a.pdf', 'application/pdf'), 'image', 'id')).toBe(
      'a.pdf tidak diunggah · Format tidak didukung. Gunakan JPG, PNG, atau PDF maks 2 MB.',
    );
    expect(precheck(file('a.jpg', 'image/jpeg', MAX_ATTACHMENT_BYTES + 1), 'image', 'id')).toBe(
      'a.jpg tidak diunggah · Ukuran 2 MB melebihi batas 2 MB per gambar.',
    );
  });

  it('explains refused uploads', () => {
    expect(uploadError('ATTACHMENT_LIMIT', undefined, 'a')).toBe('Sudah ada 3 gambar · hapus satu dulu.');
    expect(uploadError('IMAGE_REJECTED', 'too-large', 'a')).toBe(
      'a tidak diunggah · Ukuran > 2 MB melebihi batas 2 MB per gambar.',
    );
    expect(uploadError('IMAGE_REJECTED', 'unsupported-type', 'a')).toMatch(/Format tidak didukung/);
    expect(uploadError('IMAGE_REJECTED', 'corrupt', 'a')).toBe('a tidak diunggah · File rusak atau tidak bisa dibaca.');
    expect(uploadError('INTERNAL', undefined, 'a')).toBe('a tidak diunggah · Coba lagi sebentar.');
  });
});

async function renderAttachments(props: Partial<AttachmentsProps> = {}) {
  const onChanged = vi.fn();
  const result = await renderApp(
    <Attachments
      transactionId="tx-1"
      attachments={[]}
      readOnly={false}
      label="Shopee"
      timeZone="Asia/Jakarta"
      onChanged={onChanged}
      {...props}
    />,
  );
  return { ...result, onChanged };
}

/** The hidden file input of a section. */
function fileInput(section: { element: () => Element }): HTMLInputElement {
  const input = section.element().querySelector('input');
  if (input === null) throw new Error('no file input');
  return input;
}

function drop(target: Element, files: File[]) {
  const transfer = new DataTransfer();
  for (const item of files) transfer.items.add(item);
  target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
}

describe('Attachments', () => {
  it('uploads a receipt from the picker, then reports the change', async () => {
    const upload = Promise.withResolvers<unknown>();
    server.addAttachment.mockReturnValue(upload.promise);
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const { screen, onChanged } = await renderAttachments();
    const receipt = screen.getByRole('region', { name: 'Struk' });
    await expect.element(receipt.getByText('Belum ada struk · seret ke sini')).toBeVisible();
    await expect.element(screen.getByText('0/3 · maks 2 MB per gambar')).toBeVisible();
    await userEvent.click(receipt.getByRole('button', { name: 'Unggah' }));
    expect(click).toHaveBeenCalledOnce();
    await userEvent.upload(fileInput(receipt), file('struk.pdf', 'application/pdf'));
    await expect.element(receipt.getByRole('button', { name: 'Mengunggah…' })).toBeDisabled();
    const [{ data }] = server.addAttachment.mock.lastCall as [{ data: FormData }];
    expect([data.get('transactionId'), data.get('kind')]).toEqual(['tx-1', 'receipt']);
    expect(data.get('file')).toMatchObject({ name: 'struk.pdf' });
    upload.resolve({ ok: true, value: {} });
    await vi.waitFor(() => {
      expect(onChanged).toHaveBeenCalledOnce();
    });
    await expect.element(receipt.getByRole('button', { name: 'Unggah' })).toBeEnabled();
  });

  it('refuses a wrong file before sending, and shows a server refusal keeping the old receipt', async () => {
    server.addAttachment.mockResolvedValue({ ok: false, code: 'IMAGE_REJECTED', detail: 'corrupt' });
    const { screen, onChanged } = await renderAttachments({ attachments: [RECEIPT] });
    const receipt = screen.getByRole('region', { name: 'Struk' });
    const input = fileInput(receipt);
    await userEvent.upload(input, file('notes.txt', 'text/plain'));
    await expect.element(receipt.getByRole('alert')).toMatchTextContent(/^notes\.txt tidak diunggah · Format/);
    expect(server.addAttachment).not.toHaveBeenCalled();
    await userEvent.upload(input, file('struk.jpg', 'image/jpeg'));
    await expect
      .element(receipt.getByRole('alert'))
      .toHaveTextContent('struk.jpg tidak diunggah · File rusak atau tidak bisa dibaca. Struk lama tetap tersimpan.');
    expect(onChanged).not.toHaveBeenCalled();
    // No file chosen: nothing happens.
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(server.addAttachment).toHaveBeenCalledOnce();
  });

  it('shows a receipt image (thumbnail, size, type, download) and a PDF receipt', async () => {
    const { screen } = await renderAttachments({ attachments: [RECEIPT] });
    const receipt = screen.getByRole('region', { name: 'Struk' });
    await expect.element(receipt.getByText('struk.jpg')).toBeVisible();
    await expect.element(receipt.getByText('117 KB · JPG')).toBeVisible();
    await expect.element(receipt.getByRole('button', { name: 'Ganti' })).toBeVisible();
    await expect
      .element(receipt.getByRole('link', { name: 'Unduh' }))
      .toHaveAttribute('href', '/api/transactions/tx-1/attachments/att-1?download=1');
    expect(receipt.element().querySelector('img')?.getAttribute('src')).toBe(
      '/api/transactions/tx-1/attachments/att-1?size=thumbnail',
    );
    await screen.unmount();

    const unnamed = await renderAttachments({ attachments: [{ ...RECEIPT, name: null }] });
    await expect.element(unnamed.screen.getByRole('button', { name: 'Lihat JPG' })).toBeVisible();
    await unnamed.screen.unmount();

    const pdf = await renderAttachments({
      attachments: [{ ...RECEIPT, mime: 'application/pdf', name: null }, image('odd', { mime: 'scan', name: null })],
    });
    const section = pdf.screen.getByRole('region', { name: 'Struk' });
    await expect.element(section.getByText('PDF', { exact: true })).toBeVisible();
    await expect.element(section.getByRole('button', { name: /^Lihat/ })).not.toBeInTheDocument();
    // An attachment that is no image does not open the lightbox.
    await userEvent.click(pdf.screen.getByRole('button', { name: 'Lihat SCAN' }));
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('adds images by picker or drop, up to three', async () => {
    server.addAttachment
      .mockResolvedValueOnce({ ok: false, code: 'ATTACHMENT_LIMIT' })
      .mockResolvedValueOnce({ ok: true, value: {} });
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const { screen, onChanged } = await renderAttachments({ attachments: [image('a')] });
    const images = screen.getByRole('region', { name: /^Gambar lain/ });
    await expect.element(images.getByText('1/3 · maks 2 MB per gambar')).toBeVisible();
    const add = images.getByRole('button', { name: /Tambah/ });
    await userEvent.click(add);
    expect(click).toHaveBeenCalledOnce();
    expect(fileInput(images).accept).toBe('image/jpeg,image/png,image/webp');
    drop(add.element(), [file('b.png', 'image/png')]);
    await expect.element(images.getByRole('alert')).toHaveTextContent('Sudah ada 3 gambar · hapus satu dulu.');
    drop(add.element(), []);
    drop(add.element(), [file('c.png', 'image/png')]);
    await vi.waitFor(() => {
      expect(onChanged).toHaveBeenCalledOnce();
    });
    expect(server.addAttachment).toHaveBeenCalledTimes(2);
    const [{ data }] = server.addAttachment.mock.lastCall as [{ data: FormData }];
    expect(data.get('kind')).toBe('image');
    await screen.unmount();

    const full = await renderAttachments({ attachments: [image('a'), image('b'), image('c')] });
    await expect.element(full.screen.getByRole('button', { name: /Tambah/ })).not.toBeInTheDocument();
  });

  it('shows the busy image button while uploading', async () => {
    server.addAttachment.mockReturnValue(Promise.withResolvers().promise);
    const { screen } = await renderAttachments();
    const add = screen.getByRole('button', { name: /Tambah/ });
    drop(add.element(), [file('b.png', 'image/png')]);
    await expect.element(screen.getByRole('button', { name: /Mengunggah…/ })).toBeDisabled();
    await expect.element(screen.getByRole('button', { name: 'Unggah' })).toBeDisabled();
  });

  it('accepts a receipt dropped on its row, unless read-only', async () => {
    server.addAttachment.mockResolvedValue({ ok: true, value: {} });
    const { screen, onChanged } = await renderAttachments();
    const row = fileInput(screen.getByRole('region', { name: 'Struk' })).parentElement ?? document.body;
    drop(row, []);
    drop(row, [file('notes.txt', 'text/plain')]);
    await expect
      .element(screen.getByRole('alert'))
      .toHaveTextContent('notes.txt tidak diunggah · Format tidak didukung. Gunakan JPG, PNG, atau PDF maks 2 MB.');
    drop(row, [file('struk.png', 'image/png')]);
    await vi.waitFor(() => {
      expect(onChanged).toHaveBeenCalledOnce();
    });
    await screen.unmount();

    const readOnly = await renderAttachments({ readOnly: true, attachments: [image('a')] });
    const readOnlyRow =
      fileInput(readOnly.screen.getByRole('region', { name: 'Struk' })).parentElement ?? document.body;
    drop(readOnlyRow, [file('struk.png', 'image/png')]);
    expect(server.addAttachment).toHaveBeenCalledOnce();
    await expect.element(readOnly.screen.getByRole('button', { name: 'Unggah' })).not.toBeInTheDocument();
    await expect.element(readOnly.screen.getByRole('button', { name: /Tambah/ })).not.toBeInTheDocument();
  });

  it('opens images in a lightbox: move with ← → and buttons, download, delete', async () => {
    server.removeAttachment
      .mockResolvedValueOnce({ ok: false, code: 'INTERNAL' })
      .mockResolvedValueOnce({ ok: true, value: {} });
    const { screen, onChanged } = await renderAttachments({ attachments: [RECEIPT, image('a'), image('b')] });
    await userEvent.click(screen.getByRole('button', { name: 'Lihat a.png' }));
    const dialog = page.getByRole('dialog', { name: 'Shopee' });
    await expect.element(dialog.getByText('2 / 3')).toBeVisible();
    await expect
      .element(dialog.getByRole('img', { name: 'Gambar 2' }))
      .toHaveAttribute('src', '/api/transactions/tx-1/attachments/a');
    await expect.element(dialog.getByText(/^117 KB · PNG · diunggah 15 Okt, 13[.:]00$/)).toBeVisible();
    await expect
      .element(dialog.getByRole('link', { name: 'Unduh' }))
      .toHaveAttribute('href', '/api/transactions/tx-1/attachments/a?download=1');
    await userEvent.keyboard('{ArrowRight}');
    await expect.element(dialog.getByText('3 / 3')).toBeVisible();
    await userEvent.click(dialog.getByRole('button', { name: 'Berikutnya' }));
    await expect.element(dialog.getByText('1 / 3')).toBeVisible();
    await userEvent.keyboard('{ArrowLeft}');
    await expect.element(dialog.getByText('3 / 3')).toBeVisible();
    await userEvent.click(dialog.getByRole('button', { name: 'Sebelumnya' }));
    await expect.element(dialog.getByText('2 / 3')).toBeVisible();
    await userEvent.keyboard('x');
    await expect.element(dialog.getByText('2 / 3')).toBeVisible();

    await userEvent.click(dialog.getByRole('button', { name: 'Hapus' }));
    // The confirmation sits over the lightbox, which Playwright never sees as stable: click it directly.
    const confirmDelete = () =>
      page
        .getByRole('alertdialog', { name: 'Hapus lampiran ini?' })
        .getByRole('button', { name: 'Hapus' })
        .element()
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await expect.element(page.getByRole('alertdialog')).toBeInTheDocument();
    confirmDelete();
    expect(server.removeAttachment).toHaveBeenCalledWith({ data: { id: 'a' } });
    await expect.element(dialog.getByRole('alert')).toHaveTextContent('Lampiran belum terhapus. Coba lagi.');
    await userEvent.click(dialog.getByRole('button', { name: 'Hapus' }));
    await expect.element(page.getByRole('alertdialog')).toBeInTheDocument();
    confirmDelete();
    await expect.element(dialog).not.toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole('button', { name: 'Lihat struk.jpg' }));
    await expect.element(page.getByRole('dialog').getByText('1 / 3')).toBeVisible();
    await userEvent.click(page.getByRole('button', { name: 'Tutup' }));
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a single image read-only, without moving or deleting', async () => {
    const { screen } = await renderAttachments({ readOnly: true, attachments: [image('a')] });
    await userEvent.click(screen.getByRole('button', { name: 'Lihat a.png' }));
    const dialog = page.getByRole('dialog');
    await expect.element(dialog.getByText('1 / 1')).toBeVisible();
    await expect.element(dialog.getByRole('button', { name: 'Hapus' })).not.toBeInTheDocument();
    await expect.element(dialog.getByRole('button', { name: 'Berikutnya' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    await expect.element(dialog).not.toBeInTheDocument();
  });
});

describe('Lightbox', () => {
  it('renders nothing for an index out of range', async () => {
    const { screen } = await renderApp(
      <Lightbox
        transactionId="tx-1"
        attachments={[]}
        index={0}
        label="Shopee"
        timeZone="Asia/Jakarta"
        readOnly={false}
        onIndexChange={vi.fn()}
        onClose={vi.fn()}
        onDeleted={vi.fn()}
      />,
    );
    expect(screen.container.textContent).toBe('');
    await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  });
});
