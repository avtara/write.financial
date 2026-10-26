// SPDX-License-Identifier: AGPL-3.0-only
import { generateDek } from '@wf/crypto/envelope';
import { describe, expect, it } from 'vitest';
import { decodeReceipt, encodeReceipt, type ReceiptPayload } from './receipt-jobs.ts';
describe('receipt evidence confidentiality', () => {
  it('authenticates both tenant and staged receipt identity and never stores plaintext names or OCR', () => {
    const dek = generateDek();
    const payload: ReceiptPayload = {
      name: 'private-apotek.jpg',
      original: { key: 'secret-object', size: 100, sha256: 'hash', mime: 'image/webp' },
      pages: [],
      timeZone: 'Asia/Jakarta',
      evidence: 'private OCR total 96500',
    };
    const encrypted = encodeReceipt(dek, 'alice', 'receipt-a', payload);
    expect(Buffer.from(encrypted).toString()).not.toContain('private');
    expect(decodeReceipt(dek, 'alice', 'receipt-a', encrypted)).toEqual(payload);
    expect(() => decodeReceipt(dek, 'bob', 'receipt-a', encrypted)).toThrow();
    expect(() => decodeReceipt(dek, 'alice', 'receipt-b', encrypted)).toThrow();
  });
});
