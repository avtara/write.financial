// SPDX-License-Identifier: AGPL-3.0-only
import { randomBytes } from 'node:crypto';
import { addKeyVersion, parseKeyring, type Keyring } from '@wf/crypto/keyring';

/** Key file text with one fresh KEK (`v1`); keys are generated at runtime so no fixture looks like a secret. */
export function keyFileText(): string {
  return `v1:${randomBytes(32).toString('base64')}\n`;
}

/** A keyring with fresh keys `v1`…`v<versions>`; the highest is active. */
export function testKeyring(versions = 1): { text: string; keyring: Keyring } {
  let text = keyFileText();
  for (let v = 1; v < versions; v++) text = addKeyVersion(text);
  return { text, keyring: parseKeyring(text) };
}
