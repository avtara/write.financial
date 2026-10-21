// SPDX-License-Identifier: AGPL-3.0-only
import type { OutboxMessage } from '@wf/db/outbox';
import type { LocalDate } from '@wf/domain/period';
import { MailNotConfiguredError } from '@wf/integrations/mailer';
import { describe, expect, it } from 'vitest';
import { fakeDb, fakeDeps, fakeMailer } from '../../test/fakes.ts';
import { createNotifyProcessor } from './notify.ts';

const USER = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c7d';
const OUTBOX = '0199f5d2-7c4e-7a3b-8c1d-2e3f4a5b6c7e';
const job = { id: `ntf.${OUTBOX}`, data: { userId: USER, outboxId: OUTBOX }, attemptsMade: 0 };

const BILL = {
  kind: 'bill_reminder',
  name: 'Netflix',
  dueDate: '2026-10-18' as LocalDate,
  amount: { amountMinor: '186000', currency: 'IDR' },
  path: '/subscriptions',
} as const;
const MESSAGE: OutboxMessage = {
  to: 'avtara@example.test',
  locale: 'id',
  recipientName: 'Avtara',
  instanceName: 'Keuangan Keluarga',
  payload: BILL,
  sentAt: null,
};

function deps(message: OutboxMessage | null, mailer = fakeMailer()) {
  const db = fakeDb();
  return fakeDeps({
    db: {
      ...db,
      outbox: {
        ...db.outbox,
        get: async (...args) => {
          db.calls.push({ method: 'outbox.get', args });
          return Promise.resolve(message);
        },
      },
    },
    mailer,
  });
}

describe('notify processor', () => {
  it('emails the outbox row in the recipient locale with an absolute link, then marks it sent', async () => {
    const d = deps(MESSAGE);
    expect(await createNotifyProcessor(d)(job)).toEqual({ sent: true });
    expect(d.mailer.sent).toEqual([
      {
        to: 'avtara@example.test',
        template: {
          kind: 'bill_reminder',
          name: 'Netflix',
          dueDate: '2026-10-18',
          amount: { amountMinor: 186_000n, currency: 'IDR' },
          url: 'https://uang.example/subscriptions',
        },
        context: { locale: 'id', instanceName: 'Keuangan Keluarga', recipientName: 'Avtara' },
      },
    ]);
    expect(d.db.calls).toEqual([
      { method: 'outbox.get', args: [USER, OUTBOX] },
      { method: 'outbox.markSent', args: [USER, OUTBOX, d.now()] },
    ]);
  });

  it('sends no amount when the payload has none (privacy mode)', async () => {
    const d = deps({ ...MESSAGE, payload: { ...BILL, amount: null } });
    await createNotifyProcessor(d)(job);
    expect(d.mailer.sent[0]?.template).toMatchObject({ amount: null });
  });

  it('emails any other notification with its message keys, opening its page or the notifications page', async () => {
    const payload = {
      kind: 'notification',
      titleKey: 'notification_low_balance_title',
      bodyKey: 'notification_low_balance_body',
      params: { account: 'GoPay', balance: null },
      path: '/accounts',
    } as const;
    const d = deps({ ...MESSAGE, payload });
    await createNotifyProcessor(d)(job);
    expect(d.mailer.sent[0]?.template).toEqual({
      kind: 'notification',
      titleKey: 'notification_low_balance_title',
      bodyKey: 'notification_low_balance_body',
      params: { account: 'GoPay', balance: null },
      url: 'https://uang.example/accounts',
    });
    const pageless = deps({ ...MESSAGE, payload: { ...payload, path: null } });
    await createNotifyProcessor(pageless)(job);
    expect(pageless.mailer.sent[0]?.template).toMatchObject({ url: 'https://uang.example/notifications' });
  });

  it('skips a row already sent or gone', async () => {
    const sent = deps({ ...MESSAGE, sentAt: new Date() });
    expect(await createNotifyProcessor(sent)(job)).toEqual({ sent: false, reason: 'already_sent' });
    const gone = deps(null);
    expect(await createNotifyProcessor(gone)(job)).toEqual({ sent: false, reason: 'gone' });
    expect([...sent.mailer.sent, ...gone.mailer.sent]).toEqual([]);
  });

  it('counts a failed attempt and rethrows, so BullMQ retries', async () => {
    const d = deps(MESSAGE, fakeMailer(new Error('421 try again later, key=sk-test-abcdefghijklmnopqrstuvwxyz')));
    await expect(createNotifyProcessor(d)(job)).rejects.toThrow('421');
    expect(d.db.calls.at(-1)).toEqual({
      method: 'outbox.markFailed',
      args: [USER, OUTBOX, expect.stringContaining('Error: 421 try again later') as unknown],
    });
    expect(d.db.calls.map(({ method }) => method)).not.toContain('outbox.markSent');
  });

  it('counts the attempt without a retry storm when no SMTP is configured', async () => {
    const d = deps(MESSAGE, fakeMailer(new MailNotConfiguredError()));
    expect(await createNotifyProcessor(d)(job)).toEqual({ sent: false, reason: 'mail_not_configured' });
    expect(d.db.calls.at(-1)).toMatchObject({ method: 'outbox.markFailed' });
  });

  it('rejects an invalid payload before reading the outbox', async () => {
    const d = deps(MESSAGE);
    await expect(createNotifyProcessor(d)({ ...job, data: { userId: USER } })).rejects.toThrow();
    expect(d.db.calls).toEqual([]);
  });
});
