// SPDX-License-Identifier: AGPL-3.0-only
import { setLocale } from '@wf/i18n/runtime';
import { beforeAll, describe, expect, it } from 'vitest';
import { resultMessage, settle } from './result.ts';

beforeAll(async () => {
  await setLocale('en', { reload: false });
});

describe('settle', () => {
  it('passes a result through', async () => {
    expect(await settle(() => Promise.resolve({ ok: true, value: 1 }))).toEqual({ ok: true, value: 1 });
    expect(await settle(() => Promise.resolve({ ok: false, code: 'FORBIDDEN' }))).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    });
  });

  it('turns a thrown error into an unknown failure', async () => {
    expect(await settle(() => Promise.reject(new TypeError('Failed to fetch')))).toEqual({
      ok: false,
      code: 'UNKNOWN',
    });
  });
});

describe('resultMessage', () => {
  it('shows the SMTP answer of a failed test email', () => {
    expect(resultMessage({ ok: false, code: 'MAIL_FAILED', detail: '535 auth failed' }, 'en')).toBe(
      'The test email could not be sent: 535 auth failed',
    );
    expect(resultMessage({ ok: false, code: 'MAIL_FAILED' }, 'en')).toBe(
      'The email could not be sent. Check the SMTP settings.',
    );
  });

  it('explains disabled invitations', () => {
    expect(resultMessage({ ok: false, code: 'INVITATIONS_DISABLED' }, 'en')).toMatch(/^Invitations only work/);
  });

  it('uses the auth messages for everything else', () => {
    expect(resultMessage({ ok: false, code: 'EMAIL_TAKEN' }, 'en')).toBe('This email is already registered.');
    expect(resultMessage({ ok: false, code: 'UNKNOWN' }, 'en')).toBe(
      resultMessage({ ok: false, code: 'SOMETHING_ELSE' }, 'en'),
    );
  });
});
