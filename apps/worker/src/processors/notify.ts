// SPDX-License-Identifier: AGPL-3.0-only
import { redactText } from '@wf/crypto/redact';
import { MailNotConfiguredError } from '@wf/integrations/mailer';
import { JOBS } from '@wf/jobs/queues';
import type { ProcessorDeps, ProcessorJob } from '../processors.ts';

export interface NotifyResult {
  /** `false` when the row was already sent or is gone, or when no SMTP is configured. */
  readonly sent: boolean;
  readonly reason?: 'already_sent' | 'gone' | 'mail_not_configured';
}

/**
 * Sends one outbox row (`ntf.{outboxId}`) by email in the recipient's locale and marks it sent. A send that fails
 * counts an attempt (`markFailed`) and rethrows, so BullMQ retries with backoff; after 5 attempts the dispatch stops
 * picking the row up. Without any SMTP (neither the setup wizard's nor `SMTP_URL`) the attempt is counted but the job
 * succeeds: retrying at once cannot help, and the dispatch re-enqueues the row only once BullMQ has dropped the
 * completed job id (a week), so an instance without email stays quiet and gives up after 5 such weeks.
 * Delivery is at least once: a crash between the SMTP hand-off and `markSent` sends the email again.
 */
export function createNotifyProcessor({
  db,
  now,
  mailer,
  publicUrl,
}: ProcessorDeps): (job: ProcessorJob) => Promise<NotifyResult> {
  return async (job) => {
    const { userId, outboxId } = JOBS.notify.parse(job.data);
    const message = await db.outbox.get(userId, outboxId);
    if (message === null) return { sent: false, reason: 'gone' };
    if (message.sentAt !== null) return { sent: false, reason: 'already_sent' };
    const { payload } = message;
    try {
      await mailer.send({
        to: message.to,
        template: {
          kind: payload.kind,
          name: payload.name,
          dueDate: payload.dueDate,
          amount:
            payload.amount === null
              ? null
              : { amountMinor: BigInt(payload.amount.amountMinor), currency: payload.amount.currency },
          url: new URL(payload.path, publicUrl).href,
        },
        context: { locale: message.locale, instanceName: message.instanceName, recipientName: message.recipientName },
      });
    } catch (error) {
      await db.outbox.markFailed(userId, outboxId, redactText(String(error)));
      if (error instanceof MailNotConfiguredError) return { sent: false, reason: 'mail_not_configured' };
      throw error;
    }
    await db.outbox.markSent(userId, outboxId, now());
    return { sent: true };
  };
}
