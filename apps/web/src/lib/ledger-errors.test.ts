// SPDX-License-Identifier: AGPL-3.0-only
import { LEDGER_ERROR_CODES } from '@wf/db/ledger-errors';
import { setLocale } from '@wf/i18n/runtime';
import { beforeAll, describe, expect, it } from 'vitest';
import { authErrorMessage } from './auth-errors.ts';
import { ledgerErrorMessage } from './ledger-errors.ts';

beforeAll(async () => {
  await setLocale('en', { reload: false });
});

describe('ledgerErrorMessage', () => {
  it('has its own words for every ledger code', () => {
    const generic = authErrorMessage({ code: 'SOMETHING_ELSE' }, 'en');
    const messages = LEDGER_ERROR_CODES.map((code) => ledgerErrorMessage(code, 'en'));
    expect(messages).not.toContain(generic);
    expect(new Set(messages).size).toBe(LEDGER_ERROR_CODES.length);
  });

  it('reads ACCOUNT_LOCKED as the FR-R3 lock, not a locked sign-in', () => {
    expect(ledgerErrorMessage('ACCOUNT_LOCKED', 'en')).toBe(
      'The currency and opening balance are locked because this account already has transactions.',
    );
  });

  it('leaves other codes to the auth messages', () => {
    expect(ledgerErrorMessage('UNAUTHENTICATED', 'en')).toBe(authErrorMessage({ code: 'UNAUTHENTICATED' }, 'en'));
    expect(ledgerErrorMessage('toString', 'en')).toBe(authErrorMessage({ code: 'toString' }, 'en'));
  });

  it('speaks Indonesian too', async () => {
    await setLocale('id', { reload: false });
    expect(ledgerErrorMessage('TOO_MANY_TAGS', 'id')).toBe('Maksimal 5 tag per transaksi.');
    await setLocale('en', { reload: false });
  });
});
