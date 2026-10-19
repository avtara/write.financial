// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { LEDGER_ERROR_CODES, LedgerError } from './ledger-errors.ts';

describe('LedgerError', () => {
  it('carries a stable code and defaults the message to it', () => {
    const error = new LedgerError('TOO_MANY_TAGS');
    expect(error).toMatchObject({ name: 'LedgerError', code: 'TOO_MANY_TAGS', message: 'TOO_MANY_TAGS' });
    expect(new LedgerError('NOT_FOUND', 'No such account').message).toBe('No such account');
  });

  it('has unique upper-case codes', () => {
    expect(new Set(LEDGER_ERROR_CODES).size).toBe(LEDGER_ERROR_CODES.length);
    for (const code of LEDGER_ERROR_CODES) expect(code).toMatch(/^[A-Z_]+$/);
  });
});
