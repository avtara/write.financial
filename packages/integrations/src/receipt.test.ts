// SPDX-License-Identifier: AGPL-3.0-only
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { prepareReceipt, receiptMime } from './receipt.ts';
import { ImageRejectedError } from './image.ts';
function pdf(pages = 1): Uint8Array {
  const parts = ['%PDF-1.4\n'];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({ length: pages }, (_value, index) => `${String(index + 3)} 0 R`).join(' ')}] /Count ${String(pages)} >>`,
    ...Array.from(
      { length: pages },
      () =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents ${String(pages + 3)} 0 R >>`,
    ),
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(parts.join('').length);
    parts.push(`${String(index + 1)} 0 obj\n${object}\nendobj\n`);
  }
  const xref = parts.join('').length;
  parts.push(
    `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((at) => `${String(at).padStart(10, '0')} 00000 n \n`)
      .join('')}trailer\n<< /Root 1 0 R /Size ${String(objects.length + 1)} >>\nstartxref\n${String(xref)}\n%%EOF\n`,
  );
  return new TextEncoder().encode(parts.join(''));
}
describe('receipt media boundary', () => {
  it('checks both claimed type and magic and enforces 2 MiB without accepting WebP/HEIC', () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(receiptMime(png, 'image/png')).toBe('image/png');
    expect(() => receiptMime(png, 'image/jpeg')).toThrow(ImageRejectedError);
    expect(() => receiptMime(png, 'image/webp')).toThrow(ImageRejectedError);
    expect(() => receiptMime(png, 'image/heic')).toThrow(ImageRejectedError);
    expect(() => receiptMime(new Uint8Array(2097153), 'application/pdf')).toThrow(ImageRejectedError);
    const boundary = new Uint8Array(2097152);
    boundary.set(png);
    expect(receiptMime(boundary, 'image/png')).toBe('image/png');
  });
  it('strips metadata and bounds vision image dimensions', async () => {
    const bytes = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: 'white' } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const result = await prepareReceipt(bytes, 'image/jpeg');
    const metadata = await sharp(result.bytes).metadata();
    expect(metadata).toMatchObject({ format: 'webp', width: 900, height: 1800 });
    expect(metadata.exif).toBeUndefined();
    expect(result.images[0]?.bytes).toEqual(result.bytes);
  });
  it('rasterizes a real PDF into WebP pages rather than sending PDF bytes to vision', async () => {
    const document = pdf();
    const result = await prepareReceipt(document, 'application/pdf');
    expect(result.bytes).toEqual(document);
    expect(result.mime).toBe('application/pdf');
    expect(result.images).toHaveLength(1);
    expect(await sharp(result.images[0]?.bytes).metadata()).toMatchObject({
      format: 'webp',
      width: 1800,
      height: 1800,
    });
  });
  it('rejects a valid PDF beyond the four-page limit before producing vision images', async () => {
    await expect(prepareReceipt(pdf(5), 'application/pdf')).rejects.toMatchObject({
      reason: 'corrupt',
      message: 'PDF cannot be read (maximum four unencrypted pages)',
    });
  });
  it('rejects corrupt documents and truncated images with a safe error', async () => {
    await expect(
      prepareReceipt(new TextEncoder().encode('%PDF-private broken document'), 'application/pdf'),
    ).rejects.toMatchObject({ reason: 'corrupt' });
    await expect(prepareReceipt(new Uint8Array([255, 216, 255]), 'image/jpeg')).rejects.toBeInstanceOf(
      ImageRejectedError,
    );
  });
});
