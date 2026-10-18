// SPDX-License-Identifier: AGPL-3.0-only
import sharp, { type Sharp } from 'sharp';

/**
 * Image upload hardening (PRD §9.1): the type comes from magic bytes, never from the file name or the client's
 * MIME type; size and pixel count are bounded before decoding; the image is auto-oriented, then re-encoded with
 * no metadata at all (EXIF incl. GPS, XMP, IPTC, ICC), so nothing the uploader's camera or editor wrote survives.
 *
 * Accepted: JPEG, PNG, WebP (animated WebP keeps its first frame). Rejected: SVG (scriptable XML), GIF (animation,
 * little value for receipts/avatars), HEIC (the prebuilt libvips has no HEVC decoder; browsers send JPEG), TIFF,
 * AVIF and everything else, to keep the decoder attack surface small.
 *
 * Output is WebP for both image and thumbnail: smaller than JPEG at equal quality, keeps PNG transparency (logos),
 * supported by every current browser and by the vision LLM APIs used for receipt OCR. Quality 80 (libwebp default
 * 75 shows artifacts on receipt text; above 85 grows size with no visible gain).
 */

export type ImageRejection = 'too-large' | 'unsupported-type' | 'too-many-pixels' | 'corrupt';

export class ImageRejectedError extends Error {
  override readonly name = 'ImageRejectedError';
  readonly reason: ImageRejection;

  constructor(reason: ImageRejection, message: string, options?: ErrorOptions) {
    super(message, options);
    this.reason = reason;
  }
}

export interface EncodedImage {
  readonly bytes: Uint8Array;
  readonly mime: 'image/webp';
  readonly width: number;
  readonly height: number;
}

export interface PreparedImage {
  readonly image: EncodedImage;
  /** At most `THUMBNAIL_SIZE` px on the longest side, never upscaled. */
  readonly thumbnail: EncodedImage;
}

export interface ImageUploadOptions {
  /** Upload size limit in bytes; default 2 MiB. */
  readonly maxBytes?: number;
  /**
   * Decoded pixel limit (decompression bombs: a 2 MiB PNG can declare billions of pixels); default 40 MP,
   * i.e. at most 160 MB of RGBA while decoding, above any phone photo that fits in 2 MiB.
   */
  readonly maxPixels?: number;
}

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const THUMBNAIL_SIZE = 320;
const WEBP_QUALITY = 80;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** The container format by magic bytes: JPEG SOI marker, PNG signature, or RIFF….WEBP. */
function detectFormat(bytes: Uint8Array): 'jpeg' | 'png' | 'webp' | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, PNG_SIGNATURE)) return 'png';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'webp';
  return null;
}

async function encode(pipeline: Sharp): Promise<EncodedImage> {
  const { data, info } = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer({ resolveWithObject: true });
  return { bytes: data, mime: 'image/webp', width: info.width, height: info.height };
}

/**
 * Validates and re-encodes an uploaded image. Throws `ImageRejectedError` with a `reason` the UI can translate.
 */
export async function prepareImageUpload(bytes: Uint8Array, options: ImageUploadOptions = {}): Promise<PreparedImage> {
  const { maxBytes = MAX_IMAGE_BYTES, maxPixels = MAX_IMAGE_PIXELS } = options;
  if (bytes.length > maxBytes) {
    throw new ImageRejectedError('too-large', `Image is ${bytes.length} bytes; the limit is ${maxBytes}`);
  }
  const format = detectFormat(bytes);
  if (format === null) throw new ImageRejectedError('unsupported-type', 'Only JPEG, PNG, and WebP images are accepted');

  const corrupt = (cause: unknown) =>
    new ImageRejectedError('corrupt', `The ${format.toUpperCase()} image could not be decoded`, { cause });

  // Header only, no pixels decoded: unlimited here so the check below reports the declared dimensions.
  const { width, height } = await sharp(bytes, { limitInputPixels: false })
    .metadata()
    .catch((error: unknown) => {
      throw corrupt(error);
    });
  if (width * height > maxPixels) {
    throw new ImageRejectedError('too-many-pixels', `Image is ${width}×${height} px; the limit is ${maxPixels} px`);
  }

  // `limitInputPixels` stays on as libvips' own guard while decoding; `failOn: 'warning'` rejects truncated data.
  const oriented = sharp(bytes, { limitInputPixels: maxPixels, failOn: 'warning' }).autoOrient();
  try {
    return {
      image: await encode(oriented.clone()),
      thumbnail: await encode(
        oriented.clone().resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'inside', withoutEnlargement: true }),
      ),
    };
  } catch (error) {
    throw corrupt(error);
  }
}
