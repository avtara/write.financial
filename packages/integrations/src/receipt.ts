// SPDX-License-Identifier: AGPL-3.0-only
import { execFile } from 'node:child_process';
import sharp from 'sharp';
import { ImageRejectedError, MAX_IMAGE_BYTES, prepareImageUpload, type EncodedImage } from './image.ts';

export const MAX_RECEIPT_PAGES = 4;
export interface PreparedReceipt {
  readonly bytes: Uint8Array;
  readonly mime: 'image/webp' | 'application/pdf';
  readonly images: readonly EncodedImage[];
}

/** Strict upload boundary, before storing anything. No extension-based decoding and no WebP/HEIC input. */
export function receiptMime(bytes: Uint8Array, mime: string): 'image/jpeg' | 'image/png' | 'application/pdf' {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES)
    throw new ImageRejectedError('too-large', 'Receipt must be between 1 byte and 2 MiB');
  const matches = (signature: readonly number[]) => signature.every((byte, index) => bytes[index] === byte);
  if (mime === 'image/jpeg' && matches([255, 216, 255])) return mime;
  if (mime === 'image/png' && matches([137, 80, 78, 71, 13, 10, 26, 10])) return mime;
  if (mime === 'application/pdf' && matches([37, 80, 68, 70, 45])) return mime;
  throw new ImageRejectedError('unsupported-type', 'Only matching JPG, PNG, and PDF receipts are accepted');
}

/** Native parsers only see pipes: no plaintext PDF or rasterized page is ever persisted to a temporary file. */
function poppler(
  command: 'pdfinfo' | 'pdftoppm',
  args: readonly string[],
  bytes: Uint8Array,
  maxBuffer: number,
): Promise<Buffer> {
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  const child = execFile(
    command,
    [...args],
    { encoding: 'buffer', timeout: 5_000, killSignal: 'SIGKILL', maxBuffer },
    (error, stdout) => {
      if (error !== null) reject(error);
      else resolve(stdout);
    },
  );
  child.stdin?.on('error', (error: Error) => {
    child.kill('SIGKILL');
    reject(error);
  });
  child.stdin?.end(bytes);
  return promise;
}

/** Poppler rasterizes real PDF pages, never passes document bytes to an image endpoint. Page count, dimensions,
 * execution time and process output are bounded; encrypted PDFs are rejected. The original PDF is stored encrypted. */
export async function prepareReceipt(bytes: Uint8Array, mime: string): Promise<PreparedReceipt> {
  const type = receiptMime(bytes, mime);
  if (type !== 'application/pdf') {
    const { image } = await prepareImageUpload(bytes);
    const { data, info } = await sharp(image.bytes)
      .resize(1800, 1800, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    const page: EncodedImage = { bytes: data, mime: 'image/webp', width: info.width, height: info.height };
    return { bytes: page.bytes, mime: page.mime, images: [page] };
  }
  try {
    const stdout = (await poppler('pdfinfo', ['-'], bytes, 32_768)).toString('utf8');
    const pages = Number(/^Pages:\s+(\d+)$/m.exec(stdout)?.[1]);
    if (!Number.isInteger(pages) || pages < 1 || pages > MAX_RECEIPT_PAGES || /^Encrypted:\s+yes/m.test(stdout))
      throw new Error('Unsupported PDF');
    const images: EncodedImage[] = [];
    for (let page = 1; page <= pages; page++) {
      const raster = await poppler(
        'pdftoppm',
        ['-f', String(page), '-l', String(page), '-singlefile', '-scale-to', '1800', '-png', '-'],
        bytes,
        16 * 1024 * 1024,
      );
      const image = await prepareImageUpload(raster, {
        maxBytes: 16 * 1024 * 1024,
        maxPixels: 1800 * 1800,
      });
      images.push(image.image);
    }
    return { bytes, mime: 'application/pdf', images };
  } catch {
    // Native stderr includes the original document's strings: never surface it or preserve it as a cause.
    throw new ImageRejectedError('corrupt', 'PDF cannot be read (maximum four unencrypted pages)');
  }
}
