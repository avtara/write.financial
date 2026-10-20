// SPDX-License-Identifier: AGPL-3.0-only
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createInstanceMailer, instanceSmtp, sendWith, smtpUrl, type SmtpConnection } from './instance-mailer.ts';
import { MailNotConfiguredError, type MailMessage } from './mailer.ts';

const SETTINGS = { smtp: null };

const MESSAGE: MailMessage = {
  to: 'budi@example.test',
  template: { kind: 'smtp_test', url: 'https://uang.example/' },
  context: { locale: 'id', instanceName: 'Keuangan Keluarga', recipientName: 'Budi' },
};

const CONNECTION: SmtpConnection = {
  host: 'smtp.example.test',
  port: 587,
  secure: false,
  username: 'wf@example.test',
  password: ['p@ss', 'w:rd/1'].join(''),
  from: 'write.financial <noreply@example.test>',
};

describe('smtpUrl', () => {
  it('encodes credentials and picks smtp or smtps', () => {
    expect(smtpUrl(CONNECTION)).toBe('smtp://wf%40example.test:p%40ssw%3Ard%2F1@smtp.example.test:587');
    expect(smtpUrl({ ...CONNECTION, secure: true, port: 465 })).toMatch(/^smtps:\/\/.+:465$/);
  });

  it('leaves out what is not set and brackets IPv6 hosts', () => {
    expect(smtpUrl({ ...CONNECTION, password: null })).toBe('smtp://wf%40example.test@smtp.example.test:587');
    expect(smtpUrl({ ...CONNECTION, username: null, host: '::1', port: 25 })).toBe('smtp://[::1]:25');
  });
});

describe('sendWith', () => {
  const received: { from: string; to: string[]; user: string | undefined }[] = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    onAuth: (auth, _session, callback) => {
      callback(null, { user: auth.username });
    },
    onData: (stream, session, callback) => {
      stream.resume();
      stream.on('end', () => {
        received.push({
          from: session.envelope.mailFrom === false ? '' : session.envelope.mailFrom.address,
          to: session.envelope.rcptTo.map((rcpt) => rcpt.address),
          user: typeof session.user === 'string' ? session.user : undefined,
        });
        callback();
      });
    },
  });
  let port = 0;

  beforeAll(async () => {
    server.listen(0, '127.0.0.1');
    await once(server.server, 'listening');
    port = (server.server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.close();
  });

  it('delivers one message with the given settings', async () => {
    await sendWith({ ...CONNECTION, host: '127.0.0.1', port, username: null, password: null }, MESSAGE);
    expect(received).toEqual([{ from: 'noreply@example.test', to: ['budi@example.test'], user: undefined }]);
  });

  it('closes the transport after a failure too', async () => {
    await expect(sendWith({ ...CONNECTION, host: '127.0.0.1', port: 1, password: null }, MESSAGE)).rejects.toThrow();
  });
});

describe('instanceSmtp', () => {
  const smtp = { host: 'smtp.example.test', port: 465, secure: true, username: 'u', from: 'u@example.test' };

  it('is null without saved SMTP settings, and decrypts the password only when one is stored', async () => {
    const smtpPassword = vi.fn(() => Promise.resolve('secret'));
    expect(await instanceSmtp({ get: () => Promise.resolve(SETTINGS), smtpPassword })()).toBeNull();
    const withPassword = { ...SETTINGS, smtp: { ...smtp, hasPassword: true } };
    expect(await instanceSmtp({ get: () => Promise.resolve(withPassword), smtpPassword })()).toEqual({
      ...smtp,
      password: 'secret',
    });
    const without = { ...SETTINGS, smtp: { ...smtp, hasPassword: false } };
    expect(await instanceSmtp({ get: () => Promise.resolve(without), smtpPassword })()).toEqual({
      ...smtp,
      password: null,
    });
    expect(smtpPassword).toHaveBeenCalledTimes(1);
  });
});

describe('createInstanceMailer', () => {
  it('prefers the instance SMTP settings', async () => {
    const send = vi.fn(() => Promise.resolve());
    const mailer = createInstanceMailer({ env: null, smtp: () => Promise.resolve(CONNECTION), send });
    await mailer.send(MESSAGE);
    expect(send).toHaveBeenCalledWith(CONNECTION, MESSAGE);
    expect(mailer.configured).toBe(false);
    mailer.close();
  });

  it('falls back to the environment SMTP, and refuses when there is none', async () => {
    const send = vi.fn(() => Promise.resolve());
    const configured = createInstanceMailer({
      env: { smtpUrl: 'smtp://127.0.0.1:1', from: 'noreply@example.test' },
      smtp: () => Promise.resolve(null),
      send,
    });
    expect(configured.configured).toBe(true);
    await expect(configured.send(MESSAGE)).rejects.toThrow();
    configured.close();
    const none = createInstanceMailer({ env: null, smtp: () => Promise.resolve(null), send });
    await expect(none.send(MESSAGE)).rejects.toBeInstanceOf(MailNotConfiguredError);
    expect(send).not.toHaveBeenCalled();
  });
});
