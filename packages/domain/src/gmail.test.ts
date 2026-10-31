// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  emptyGmailFilters,
  filterEmail,
  isGmailManualDuplicate,
  parseGmailExtraction,
  type GmailFilters,
} from './gmail.ts';

/** The design `D6NOl8` example: bank and e-wallet senders, transaction keywords, promo noise. */
const FILTERS: GmailFilters = {
  senders: ['bca.co.id', 'billing@pln.co.id', 'no-reply@tokopedia.com'],
  keywords: ['transaksi', 'tagihan'],
  ignoreKeywords: ['promo', 'OTP'],
};

describe('filterEmail', () => {
  it('passes a sender whose address is on the allowlist (case-insensitive)', () => {
    expect(filterEmail('Billing@PLN.co.id', 'Tagihan listrik Oktober', FILTERS)).toBe('passed');
  });

  it('passes a sender whose domain is on the allowlist', () => {
    expect(filterEmail('kbc-bca@bca.co.id', 'Transaksi Rp 350.000', FILTERS)).toBe('passed');
  });

  it('rejects a sender that matches neither an address nor a domain', () => {
    expect(filterEmail('news@shopee.co.id', 'Transaksi kamu', FILTERS)).toBe('filtered');
    expect(filterEmail('someone@gmail.com', 'tagihan', FILTERS)).toBe('filtered');
  });

  it('refines by keyword: a matching subject passes, a non-matching one does not', () => {
    expect(filterEmail('cs@bca.co.id', 'Saldo kamu bertambah', FILTERS)).toBe('filtered');
    expect(filterEmail('cs@bca.co.id', 'TRANSAKSI berhasil', FILTERS)).toBe('passed');
  });

  it('requires no keyword when the keyword list is empty', () => {
    expect(filterEmail('cs@bca.co.id', 'Selamat pagi', { ...FILTERS, keywords: [] })).toBe('passed');
  });

  it('passes everything when the allowlist is empty', () => {
    expect(filterEmail('news@shopee.co.id', 'Flash sale', { ...FILTERS, senders: [], keywords: [] })).toBe('passed');
  });

  it('rejects on an ignore keyword whatever the senders and keywords said', () => {
    expect(filterEmail('cs@bca.co.id', 'Transaksi promo 10.10', FILTERS)).toBe('ignored_keyword');
    expect(filterEmail('no-reply@otp-sender.test', 'kode OTP', FILTERS)).toBe('ignored_keyword');
  });

  it('matches keywords on the sender too, trimmed and case-insensitively', () => {
    expect(filterEmail('promo@bca.co.id', 'Tagihan', FILTERS)).toBe('ignored_keyword');
  });

  it('ignores blank ignore-keywords and trims the stored senders and keywords', () => {
    const filters: GmailFilters = { senders: [' bca.co.id '], keywords: [' tagihan '], ignoreKeywords: [''] };
    expect(filterEmail('cs@BCA.CO.ID', 'Tagihan listrik', filters)).toBe('passed');
  });

  it('rejects everything when the keyword list holds only blanks (nothing can match)', () => {
    expect(filterEmail('cs@bca.co.id', 'apa saja', { ...FILTERS, keywords: ['  '] })).toBe('filtered');
  });

  it('normalizes mailbox headers and refuses malformed or spoofed domains', () => {
    expect(filterEmail('Bank <CS@BCA.CO.ID>', 'Tagihan', FILTERS)).toBe('passed');
    expect(filterEmail('bca.co.id', 'Tagihan', FILTERS)).toBe('filtered');
    expect(filterEmail('cs@bca.co.id.evil.test', 'Tagihan', FILTERS)).toBe('filtered');
  });
});

describe('emptyGmailFilters', () => {
  it('starts open: every sender and every subject passes', () => {
    const filters = emptyGmailFilters();

    expect(filters).toEqual({ senders: [], keywords: [], ignoreKeywords: [] });
    expect(filterEmail('siapa@pun.test', 'apa saja', filters)).toBe('passed');
  });
});

describe('nullable financial extraction and confidence', () => {
  const value = {
    amountMinor: '350000',
    occurredAt: '2026-10-18T02:00:00Z',
    merchant: 'PLN',
    currency: 'IDR',
    accountId: null,
    categoryId: null,
    confidence: { amount: 97, date: 97, merchant: 97, currency: 97, account: 0, category: 0 },
  };
  it('keeps every per-field uncertainty and uses bigint minor units without guessing required fields', () => {
    expect(parseGmailExtraction(JSON.stringify(value))).toMatchObject({
      amountMinor: 350000n,
      accountId: null,
      categoryId: null,
      confidence: { account: 0 },
    });
    expect(
      parseGmailExtraction(
        JSON.stringify({ ...value, amountMinor: null, occurredAt: null, merchant: null, currency: null }),
      ),
    ).toMatchObject({ amountMinor: null, occurredAt: null, merchant: null, currency: null });
  });
  it.each([
    { amountMinor: '0' },
    { amountMinor: '-1' },
    { amountMinor: 350000.5 },
    { amountMinor: -350000 },
    { amountMinor: 0 },
    { amountMinor: Number.MAX_SAFE_INTEGER + 1 },
    { amountMinor: '1.2' },
    { amountMinor: '9'.repeat(40) },
    { occurredAt: 'not-a-date' },
    { occurredAt: '2026-02-30T00:00:00Z' },
    { currency: 'IDRX' },
    { currency: '1$R' },
    { merchant: '' },
    { merchant: 'x'.repeat(201) },
    { accountId: 'another-user-account' },
    { categoryId: '' },
    { confidence: { ...value.confidence, amount: 101 } },
    { confidence: null },
    { confidence: {} },
  ])('refuses malformed provider fields without coercion: %j', (override) => {
    expect(() => parseGmailExtraction(JSON.stringify({ ...value, ...override }))).toThrow();
  });
  it('rejects unbounded and non-JSON provider answers', () => {
    expect(() => parseGmailExtraction('x'.repeat(16385))).toThrow();
    expect(() => parseGmailExtraction('not JSON')).toThrow();
    expect(() => parseGmailExtraction(`[${JSON.stringify(value)}]`)).toThrow();
  });
  it('accepts the JSON wrapped in one Markdown fence or prose, as chat models often answer', () => {
    expect(parseGmailExtraction(`\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`)).toMatchObject({
      amountMinor: 350000n,
    });
    expect(parseGmailExtraction(`\`\`\`\n${JSON.stringify(value)}\n\`\`\``)).toMatchObject({ amountMinor: 350000n });
    expect(parseGmailExtraction(`Here you go:\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``)).toMatchObject({
      amountMinor: 350000n,
    });
  });
  it('accepts minor units sent as a JSON integer instead of a decimal string', () => {
    expect(parseGmailExtraction(JSON.stringify({ ...value, amountMinor: 350000 }))).toMatchObject({
      amountMinor: 350000n,
    });
  });
  it('parses the answers ZenMux openai/gpt-4o-mini actually returned', () => {
    const answer =
      '{"amountMinor":"10000","occurredAt":"2026-10-31T23:31:00+07:00","merchant":null,"currency":"IDR","accountId":"01a1877c-1859-71f3-ab96-cf2e8c50c542","categoryId":"01a18b57-d73d-7201-a5fd-7d389b143e71","confidence":{"amount":100,"date":100,"merchant":0,"currency":100,"account":100,"category":100}}';
    const expected = {
      amountMinor: 10000n,
      occurredAt: new Date('2026-10-31T16:31:00Z'),
      merchant: null,
      currency: 'IDR',
      accountId: '01a1877c-1859-71f3-ab96-cf2e8c50c542',
      categoryId: '01a18b57-d73d-7201-a5fd-7d389b143e71',
    };
    expect(parseGmailExtraction(`\`\`\`json\n${answer}\n\`\`\``)).toMatchObject(expected);
    expect(
      parseGmailExtraction(`\`\`\`json\n${answer.replace('"amountMinor":"10000"', '"amountMinor": 10000')}\n\`\`\``),
    ).toMatchObject(expected);
    expect(parseGmailExtraction(`Berikut hasilnya:\n\`\`\`json\n${answer}\n\`\`\``)).toMatchObject(expected);
  });
  it('dedupes on exact-decimal amount tolerance, instant and currency, not a guessed account or merchant', () => {
    const extraction = parseGmailExtraction(JSON.stringify(value));
    const candidate = { amountMinor: 350000n, occurredAt: new Date('2026-10-18T04:00:00Z'), currency: 'IDR' };
    expect(isGmailManualDuplicate(extraction, candidate)).toBe(true);
    expect(isGmailManualDuplicate({ ...extraction, amountMinor: 353500n }, candidate)).toBe(true);
    expect(isGmailManualDuplicate({ ...extraction, amountMinor: 346500n }, candidate)).toBe(true);
    expect(isGmailManualDuplicate({ ...extraction, amountMinor: 353501n }, candidate)).toBe(false);
    expect(isGmailManualDuplicate(extraction, { ...candidate, occurredAt: new Date('2026-10-18T04:00:00.001Z') })).toBe(
      false,
    );
    expect(isGmailManualDuplicate(extraction, { ...candidate, currency: 'USD' })).toBe(false);
    expect(isGmailManualDuplicate({ ...extraction, amountMinor: null }, candidate)).toBe(false);
    expect(isGmailManualDuplicate({ ...extraction, occurredAt: null }, candidate)).toBe(false);
  });
});
