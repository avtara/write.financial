// SPDX-License-Identifier: AGPL-3.0-only
import type { AddressInfo } from 'node:net';
import { simpleParser, type ParsedMail } from 'mailparser';
import { SMTPServer } from 'smtp-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMailer, MailNotConfiguredError } from './mailer.ts';

/** In-process SMTP server that keeps every received message. */
let server: SMTPServer;
let port: number;
const received: ParsedMail[] = [];

beforeAll(async () => {
  server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    logger: false,
    onData(stream, _session, callback) {
      simpleParser(stream).then(
        (mail) => {
          received.push(mail);
          callback();
        },
        (error: unknown) => {
          callback(error instanceof Error ? error : new Error('Unparseable message'));
        },
      );
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(resolve);
  });
});

describe('createMailer with SMTP', () => {
  it('sends the rendered email with HTML and a plain-text alternative from MAIL_FROM', async () => {
    const mailer = createMailer({ smtpUrl: `smtp://127.0.0.1:${port}`, from: 'write.financial <noreply@wf.test>' });
    expect(mailer.configured).toBe(true);
    await mailer.send({
      to: 'budi@example.test',
      template: { kind: 'password_reset', url: 'https://wf.example/reset/abc', expiresInMinutes: 30 },
      context: { locale: 'en', instanceName: 'write.financial', recipientName: 'Budi' },
    });
    mailer.close();

    const mail = received.at(-1);
    expect(mail?.subject).toBe('Reset your password');
    expect(mail?.from?.value).toEqual([{ name: 'write.financial', address: 'noreply@wf.test' }]);
    expect(mail?.to).toMatchObject({ text: 'budi@example.test' });
    expect(mail?.html).toContain('href="https://wf.example/reset/abc"');
    expect(mail?.text).toContain('This link is valid for 30 minutes.');
    expect(mail?.text).toContain('https://wf.example/reset/abc');
  });
});

describe('createMailer without SMTP', () => {
  it('reports that it is not configured and rejects every send', async () => {
    const mailer = createMailer(null);
    expect(mailer.configured).toBe(false);
    await expect(
      mailer.send({
        to: 'budi@example.test',
        template: { kind: 'verify_email', url: 'https://wf.example/verify' },
        context: { locale: 'id', instanceName: 'write.financial', recipientName: null },
      }),
    ).rejects.toBeInstanceOf(MailNotConfiguredError);
    expect(() => {
      mailer.close();
    }).not.toThrow();
  });

  it('names the missing settings without echoing any value', () => {
    expect(new MailNotConfiguredError().message).toBe('Email is not configured: set SMTP_URL and MAIL_FROM');
  });
});
