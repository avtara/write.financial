// SPDX-License-Identifier: AGPL-3.0-only
import { AiError, calculateAiCost } from '@wf/domain/ai';
import { receiptPrompt, RECEIPT_INPUT_TOKENS, RECEIPT_MAX_TOKENS, UnreadableReceiptError } from '@wf/domain/receipt';
import { JOBS } from '@wf/jobs/queues';
import type { Processor, ProcessorDeps } from '../processors.ts';

/** Durable at-most-once egress. Crashed/unknown requests keep their conservative reservation, never auto-rebill. */
export function createOcrProcessor({ db, receipt }: ProcessorDeps): Processor {
  return async (job) => {
    const { userId, receiptId } = JOBS.ocr.parse(job.data);
    const claimed = await db.receipts.claim(userId, receiptId);
    if (claimed === null) return { receiptId, replay: true };
    let evidence: string | null = null;
    try {
      if (receipt === undefined) throw new Error('Receipt processor services unavailable');
      const credential = await db.ai.credential(userId, claimed.provider, claimed.revision);
      const pricing = credential.pricing;
      if (pricing === null) throw new AiError('AI_PRICING_REQUIRED');
      const images = await Promise.all(
        claimed.payload.pages.map(async (page) => {
          const image = await receipt.objects.get(userId, page.key, page.sha256);
          if (image.mime !== 'image/webp') throw new UnreadableReceiptError();
          return { mime: 'image/webp' as const, bytes: image.bytes };
        }),
      );
      const prompt = receiptPrompt({ ...claimed, timeZone: claimed.payload.timeZone });
      await db.ai.reserve(userId, {
        id: receiptId,
        expectedRevision: claimed.revision,
        provider: claimed.provider,
        modelId: credential.modelId,
        feature: 'receipt',
        costUsd: calculateAiCost(pricing, {
          inputTokens: RECEIPT_INPUT_TOKENS + new TextEncoder().encode(prompt).byteLength,
          outputTokens: RECEIPT_MAX_TOKENS,
          images: images.length,
        }),
        dataSent: {
          images: images.length,
          categories: claimed.categories.length,
          accounts: claimed.accounts.length,
          transactions: 0,
        },
        needsDraftPermission: true,
      });
      const result = await receipt.client.complete({
        ...credential,
        pricing,
        maxTokens: RECEIPT_MAX_TOKENS,
        messages: [{ role: 'user', content: prompt, images }],
      });
      evidence = result.content;
      // Settlement precedes parsing: even an unreadable answer can cost money.
      await db.ai.settle(userId, receiptId, {
        status: result.status,
        httpStatus: result.httpStatus,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        costSource: result.costUsd === null ? 'estimated' : 'reported',
        durationMs: result.durationMs,
        errorCode: result.errorCode,
        toolCalls: [],
        connectionStatus: result.status === 'ok' ? 'connected' : 'error',
        pricing,
      });
      if (result.status !== 'ok') throw new AiError(result.status === 'timeout' ? 'AI_TIMEOUT' : 'AI_ASSISTANT_FAILED');
      if (result.toolCalls.length !== 0 || result.finishReason === 'length') throw new UnreadableReceiptError();
      await db.receipts.complete(userId, receiptId, result.content ?? '');
      return { receiptId, status: 'ready' };
    } catch (error) {
      // Never log provider text, object errors, credentials or native decoder diagnostics in BullMQ results/errors.
      const code =
        error instanceof UnreadableReceiptError ? error.code : error instanceof AiError ? error.code : 'RECEIPT_FAILED';
      await db.receipts.fail(userId, receiptId, code, evidence ?? undefined);
      return { receiptId, status: 'failed', code };
    }
  };
}
