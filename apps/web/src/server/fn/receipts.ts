// SPDX-License-Identifier: AGPL-3.0-only
import { createServerFn } from '@tanstack/react-start';
import type { ReceiptObject } from '@wf/db/receipt-jobs';
import type { ReceiptView } from '@wf/db/receipts';
import { AiError, calculateAiCost, canReserveAiCost } from '@wf/domain/ai';
import { RECEIPT_INPUT_TOKENS, RECEIPT_MAX_TOKENS } from '@wf/domain/receipt';
import { ImageRejectedError } from '@wf/integrations/image';
import { prepareReceipt } from '@wf/integrations/receipt';
import * as z from 'zod';
import { attempt, requireSession, UploadRejectedError, type Result } from '../access.ts';
import { services } from '../runtime.ts';

/** No OCR or paid requests in this process; sanitize, encrypt, stage, then enqueue identifiers only. */
export const uploadReceipt = createServerFn({ method: 'POST' })
  .validator(z.instanceof(FormData))
  .handler(async ({ context, data }): Promise<Result<ReceiptView>> => {
    const s = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, { twoFactor: true }, s.now());
      const id = z.uuid().parse(data.get('id'));
      const settings = await s.ai.settings(user.id);
      if (!settings.allowReadFinancial || !settings.allowCreateDrafts) throw new AiError('AI_PERMISSION_REQUIRED');
      const credential = await s.ai.credential(user.id, settings.provider, settings.revision ?? '');
      if (credential.pricing === null) throw new AiError('AI_PRICING_REQUIRED');
      const existing = await s.receipts.get(user.id, id).catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'NOT_FOUND') return null;
        throw error;
      });
      if (existing !== null) {
        if (existing.status === 'queued') await s.receiptQueue.enqueue(user.id, id);
        return existing;
      }
      if (data.getAll('file').length !== 1) throw new UploadRejectedError('unsupported-type');
      const file = z.instanceof(File).parse(data.get('file'));
      if (file.size === 0 || file.size > 2 * 1024 * 1024) throw new UploadRejectedError('too-large');
      const prepared = await prepareReceipt(new Uint8Array(await file.arrayBuffer()), file.type).catch(
        (error: unknown) => {
          if (error instanceof ImageRejectedError) throw new UploadRejectedError(error.reason);
          throw error;
        },
      );
      const estimated = calculateAiCost(credential.pricing, {
        inputTokens: RECEIPT_INPUT_TOKENS,
        outputTokens: RECEIPT_MAX_TOKENS,
        images: prepared.images.length,
      });
      if (
        !canReserveAiCost({
          spentUsd: settings.usage.spentUsd,
          reservedUsd: settings.usage.reservedUsd,
          nextUsd: estimated,
          limitUsd: settings.usage.limitUsd,
        })
      )
        throw new AiError('AI_COST_LIMIT');
      const stored: ReceiptObject[] = [];
      let staged = false;
      try {
        const original = {
          ...(await s.attachmentStore.put(user.id, prepared.bytes, prepared.mime)),
          mime: prepared.mime,
        };
        stored.push(original);
        const pages: ReceiptObject[] = [];
        for (const image of prepared.images) {
          const page =
            prepared.mime === 'image/webp'
              ? original
              : { ...(await s.attachmentStore.put(user.id, image.bytes, image.mime)), mime: image.mime };
          if (page !== original) stored.push(page);
          pages.push(page);
        }
        staged = await s.receipts.stage(user.id, {
          id,
          revision: credential.revision,
          provider: settings.provider,
          payload: {
            name: file.name.trim().slice(0, 255) || 'receipt',
            original,
            pages,
            timeZone: user.timezone ?? 'Asia/Jakarta',
            evidence: null,
          },
        });
      } finally {
        // A concurrent replay owns the first staged payload. Do not leak the redundant objects.
        if (!staged) await Promise.all(stored.map((object) => s.attachmentStore.delete(user.id, object.key)));
      }
      // If Valkey is unavailable, the staged queued state remains. Retrying the same upload id re-enqueues it.
      await s.receiptQueue.enqueue(user.id, id);
      return s.receipts.get(user.id, id);
    });
  });
export const getReceipt = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ context, data }): Promise<Result<ReceiptView>> => {
    const s = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, s.now());
      return s.receipts.get(user.id, data.id);
    });
  });
export const cancelReceipt = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ context, data }): Promise<Result<void>> => {
    const s = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, s.now());
      const keys = await s.receipts.cancel(user.id, data.id);
      await Promise.all(keys.map((key) => s.attachmentStore.delete(user.id, key)));
    });
  });

/** The user supplies a complete manual draft after an unreadable receipt. This still does not write the ledger. */
export const prepareManualReceipt = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id: z.uuid(),
      accountId: z.uuid(),
      amountMinor: z.bigint().positive(),
      categoryId: z.uuid().nullable(),
      occurredAt: z.date(),
      description: z.string().max(200),
      note: z.string().max(2000),
      tags: z.array(z.string().min(1).max(64)).max(5),
    }),
  )
  .handler(async ({ context, data }): Promise<Result<{ reviewItemId: string }>> => {
    const s = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, s.now());
      const { id, ...draft } = data;
      return { reviewItemId: await s.receipts.manual(user.id, id, { ...draft, type: 'expense', source: 'receipt' }) };
    });
  });
