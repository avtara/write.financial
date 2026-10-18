// SPDX-License-Identifier: AGPL-3.0-only
import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ImageRejectedError, MAX_IMAGE_BYTES, prepareImageUpload, type ImageRejection } from './image.ts';

const solid = (width: number, height: number, channels: 3 | 4 = 3) =>
  sharp({ create: { width, height, channels, background: { r: 200, g: 30, b: 30, alpha: 0.5 } } });

/** A JPEG straight from a "phone": camera make, a GPS position in Jakarta, rotated 90° via EXIF orientation 6. */
async function phoneJpeg(): Promise<Buffer> {
  return solid(40, 20)
    .withExif({
      IFD0: { Make: 'WfTestCam' },
      IFD3: {
        GPSLatitudeRef: 'S',
        GPSLatitude: '6/1 12/1 3000/100',
        GPSLongitudeRef: 'E',
        GPSLongitude: '106/1 49/1 0/1',
        GPSMapDatum: 'WfGpsDatum',
      },
    })
    .withMetadata({ orientation: 6 })
    .withIccProfile('p3')
    .withXmp(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">' +
        '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/" dc:creator="WfXmpAuthor"/></rdf:RDF></x:xmpmeta>',
    )
    .jpeg()
    .toBuffer();
}

/** Minimal PNG whose header declares `width`×`height` (pixel data is not needed to read the header). */
function pngHeader(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth; colour type 0 (grey), default compression/filter/interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.alloc(0))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function rejection(promise: Promise<unknown>): Promise<ImageRejectedError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  if (!(error instanceof ImageRejectedError)) throw new Error(`expected ImageRejectedError, got ${String(error)}`);
  return error;
}

const expectRejected = async (promise: Promise<unknown>, reason: ImageRejection) => {
  const error = await rejection(promise);
  expect(error.name).toBe('ImageRejectedError');
  expect(error.reason).toBe(reason);
  return error;
};

describe('prepareImageUpload', () => {
  it('auto-orients, then strips every metadata block including EXIF GPS', async () => {
    const input = await phoneJpeg();
    const before = await sharp(input).metadata();
    expect(before.orientation).toBe(6);
    expect(before.exif?.includes('WfTestCam')).toBe(true);
    expect(before.exif?.includes('WfGpsDatum')).toBe(true);
    expect(before.icc).toBeDefined();
    expect(before.xmpAsString).toContain('WfXmpAuthor');

    const { image, thumbnail } = await prepareImageUpload(input);
    for (const output of [image, thumbnail]) {
      const after = await sharp(output.bytes).metadata();
      expect(after.format).toBe('webp');
      expect(after.orientation).toBeUndefined();
      expect(after.exif).toBeUndefined();
      expect(after.xmp).toBeUndefined();
      expect(after.iptc).toBeUndefined();
      expect(after.icc).toBeUndefined();
      expect(Buffer.from(output.bytes).includes('WfTestCam')).toBe(false);
      expect(Buffer.from(output.bytes).includes('WfGpsDatum')).toBe(false);
      expect(Buffer.from(output.bytes).includes('WfXmpAuthor')).toBe(false);
      expect(Buffer.from(output.bytes).includes('Exif')).toBe(false);
      expect([after.width, after.height]).toEqual([20, 40]);
    }
    expect(image).toMatchObject({ mime: 'image/webp', width: 20, height: 40 });
  });

  it('re-encodes PNG (keeping transparency) and WebP input as WebP', async () => {
    const png = await solid(30, 30, 4).png().toBuffer();
    const fromPng = await prepareImageUpload(png);
    expect((await sharp(fromPng.image.bytes).metadata()).hasAlpha).toBe(true);

    const webp = await solid(30, 10).webp().toBuffer();
    const fromWebp = await prepareImageUpload(webp);
    expect(fromWebp.image).toMatchObject({ mime: 'image/webp', width: 30, height: 10 });
  });

  it('makes a thumbnail of at most 320 px on the longest side, never upscaled', async () => {
    const wide = await prepareImageUpload(await solid(1000, 500).png().toBuffer());
    expect(wide.image).toMatchObject({ width: 1000, height: 500 });
    expect(wide.thumbnail).toMatchObject({ mime: 'image/webp', width: 320, height: 160 });
    expect((await sharp(wide.thumbnail.bytes).metadata()).width).toBe(320);

    const tall = await prepareImageUpload(await solid(300, 900).jpeg().toBuffer());
    expect(tall.thumbnail).toMatchObject({ width: 107, height: 320 });

    const small = await prepareImageUpload(await solid(100, 50).jpeg().toBuffer());
    expect(small.thumbnail).toMatchObject({ width: 100, height: 50 });
  });

  it('decides the type by magic bytes, not by the name the client claims', async () => {
    // "receipt.jpg" that is really a PNG: accepted and processed as PNG.
    const pngNamedJpg = await solid(8, 8).png().toBuffer();
    await expect(prepareImageUpload(pngNamedJpg)).resolves.toMatchObject({ image: { width: 8, height: 8 } });

    // "receipt.jpg" that is really HTML: rejected.
    await expectRejected(
      prepareImageUpload(Buffer.from('<!doctype html><script>alert(1)</script>')),
      'unsupported-type',
    );
  });

  it.each([
    ['SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')],
    ['GIF', Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1')],
    ['HEIC', Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic\0\0\0\0mif1heic')])],
    ['PDF', Buffer.from('%PDF-1.7\n')],
    ['RIFF WAVE', Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1')],
    ['truncated PNG signature', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    ['empty file', Buffer.alloc(0)],
  ])('rejects %s as unsupported', async (_name, input) => {
    const error = await expectRejected(prepareImageUpload(input), 'unsupported-type');
    expect(error.message).toBe('Only JPEG, PNG, and WebP images are accepted');
  });

  it('rejects files above the size limit before looking at them (default 2 MiB)', async () => {
    const error = await expectRejected(prepareImageUpload(Buffer.alloc(MAX_IMAGE_BYTES + 1)), 'too-large');
    expect(error.message).toBe(`Image is ${MAX_IMAGE_BYTES + 1} bytes; the limit is ${MAX_IMAGE_BYTES}`);
    expect(MAX_IMAGE_BYTES).toBe(2 * 1024 * 1024);

    const atLimit = Buffer.alloc(MAX_IMAGE_BYTES);
    atLimit.set([0xff, 0xd8, 0xff]);
    await expectRejected(prepareImageUpload(atLimit), 'corrupt');

    const png = await solid(4, 4).png().toBuffer();
    await expectRejected(prepareImageUpload(png, { maxBytes: png.length - 1 }), 'too-large');
    await expect(prepareImageUpload(png, { maxBytes: png.length })).resolves.toBeDefined();
  });

  it('rejects decompression bombs by the declared pixel count before decoding (default 40 MP)', async () => {
    const bomb = pngHeader(20_000, 20_000);
    expect(bomb.length).toBeLessThan(100);
    const error = await expectRejected(prepareImageUpload(bomb), 'too-many-pixels');
    expect(error.message).toBe('Image is 20000×20000 px; the limit is 40000000 px');

    await expectRejected(prepareImageUpload(pngHeader(8000, 5001)), 'too-many-pixels');

    const png = await solid(40, 20).png().toBuffer();
    await expectRejected(prepareImageUpload(png, { maxPixels: 799 }), 'too-many-pixels');
    await expect(prepareImageUpload(png, { maxPixels: 800 })).resolves.toBeDefined();
  });

  it('rejects files with valid magic bytes that do not decode', async () => {
    const garbage = await expectRejected(prepareImageUpload(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])), 'corrupt');
    expect(garbage.message).toBe('The JPEG image could not be decoded');
    expect(garbage.cause).toBeInstanceOf(Error);

    const jpeg = await solid(64, 64).jpeg().toBuffer();
    await expectRejected(prepareImageUpload(jpeg.subarray(0, jpeg.length / 2)), 'corrupt');

    // A PNG header that passes the pixel check but carries no pixel data fails when decoding.
    const empty = await expectRejected(prepareImageUpload(pngHeader(10, 10)), 'corrupt');
    expect(empty.message).toBe('The PNG image could not be decoded');

    const webp = Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 junk', 'latin1');
    expect((await expectRejected(prepareImageUpload(webp), 'corrupt')).message).toBe(
      'The WEBP image could not be decoded',
    );
  });
});
