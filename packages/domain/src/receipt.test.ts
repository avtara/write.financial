// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { isReceiptDuplicate, parseReceiptExtraction, UnreadableReceiptError } from './receipt.ts';
const raw = {
  merchant: ' Apotek K-24 ',
  description: '',
  amountMinor: '96500',
  currency: 'IDR',
  date: '2026-10-15',
  time: '15:20',
  accountId: null,
  categoryId: null,
  uncertain: ['account'],
  items: [
    { name: 'Paracetamol 500mg', quantity: '2', amountMinor: '24000', uncertain: false },
    { name: 'Vitamin C', quantity: '1', amountMinor: '45000', uncertain: false },
    { name: 'Plester luka', quantity: '1', amountMinor: null, uncertain: true },
    { name: 'Minyak kayu putih', quantity: '1', amountMinor: '15000', uncertain: false },
  ],
};
describe('receipt extraction', () => {
  it('preserves exact money, local time, line items and uncertainty without inventing missing prices', () => {
    const value = parseReceiptExtraction(JSON.stringify(raw), 'Asia/Jakarta');
    expect(value).toMatchObject({
      merchant: 'Apotek K-24',
      description: 'Apotek K-24',
      amountMinor: 96500n,
      occurredAt: new Date('2026-10-15T08:20:00Z'),
      uncertain: ['account'],
    });
    expect(value.items).toEqual(
      raw.items.map((item) => ({ ...item, amountMinor: item.amountMinor === null ? null : BigInt(item.amountMinor) })),
    );
  });
  it.each([
    { amountMinor: null },
    { amountMinor: '0' },
    { amountMinor: '96.500' },
    { date: null },
    { date: '2026-02-30' },
    { time: '25:20' },
    { accountId: 'someone' },
    { items: [{ name: '', quantity: '1', amountMinor: '1', uncertain: false }] },
  ])('refuses unreadable or malformed structured fields %j', (patch) => {
    expect(() => parseReceiptExtraction(JSON.stringify({ ...raw, ...patch }), 'Asia/Jakarta')).toThrow(
      UnreadableReceiptError,
    );
  });
  it.each(['null', '[]', 'not JSON', ' '.repeat(32769)])('refuses non-structured or oversized responses', (text) => {
    expect(() => parseReceiptExtraction(text, 'Asia/Jakarta')).toThrow(UnreadableReceiptError);
  });
});
describe('receipt duplicates', () => {
  const receipt = { merchant: ' Indomaret ', amountMinor: 110000n, occurredAt: new Date('2026-10-15T00:55:00Z') };
  const candidate = {
    merchant: 'INDOMARET',
    description: null,
    amountMinor: 110000n,
    occurredAt: new Date('2026-10-15T02:55:00Z'),
  };
  it('includes exactly two hours and one percent using bigint, not rounded percentages', () => {
    expect(isReceiptDuplicate(receipt, candidate)).toBe(true);
    expect(isReceiptDuplicate({ ...receipt, amountMinor: 111100n }, candidate)).toBe(true);
    expect(isReceiptDuplicate({ ...receipt, amountMinor: 108900n }, candidate)).toBe(true);
    expect(isReceiptDuplicate({ ...receipt, amountMinor: 111101n }, candidate)).toBe(false);
    expect(
      isReceiptDuplicate(receipt, { ...candidate, occurredAt: new Date(candidate.occurredAt.getTime() + 1) }),
    ).toBe(false);
    expect(isReceiptDuplicate(receipt, { ...candidate, merchant: 'Other' })).toBe(false);
    expect(isReceiptDuplicate(receipt, { ...candidate, merchant: null, description: 'Indomaret' })).toBe(true);
    expect(isReceiptDuplicate(receipt, { ...candidate, merchant: null, description: null })).toBe(false);
  });
});
