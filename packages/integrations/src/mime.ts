// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A canonical media type such as `image/webp` or `application/pdf`: lowercase `type/subtype` with RFC 6838
 * restricted names, no parameters, at most 255 characters (so its length fits in one byte).
 */
export const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;
