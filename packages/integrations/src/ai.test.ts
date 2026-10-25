// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import * as z from 'zod';
import { createAiClient, type AiCompletionInput } from './ai.ts';

const pricing = { inputUsdPerMillion: '0.15', outputUsdPerMillion: '0.6', requestUsd: '0', imageUsd: '0' };
const completion = (extra: Partial<AiCompletionInput> = {}): AiCompletionInput => ({
  provider: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKey: 'fixture-private-key',
  modelId: 'fixture/model',
  messages: [{ role: 'user', content: 'A private prompt' }],
  maxTokens: 32,
  pricing,
  ...extra,
});
const reply = (body: string) =>
  vi.fn<typeof fetch>(() => Promise.resolve(new Response(body, { headers: { 'Content-Type': 'application/json' } })));

describe('provider model catalogs', () => {
  it('uses the highest ZenMux per-million price and does not authenticate a key with its public catalog', async () => {
    let publicRequest = false;
    const fetcher = vi.fn<typeof fetch>((_url, init) => {
      publicRequest = !new Headers(init?.headers).has('Authorization');
      return Promise.resolve(
        Response.json({
          data: [
            {
              id: 'deepseek/fixture',
              display_name: 'Fixture',
              context_length: 65536,
              pricings: {
                prompt: [
                  { value: 0.075, unit: 'perMTokens', currency: 'USD' },
                  { value: 0.15, unit: 'perMTokens', currency: 'USD' },
                ],
                completion: [
                  { value: 0.3, unit: 'perMTokens', currency: 'USD' },
                  { value: 0.6, unit: 'perMTokens', currency: 'USD' },
                ],
              },
            },
          ],
        }),
      );
    });
    const result = await createAiClient({ allowedBaseUrls: [], fetch: fetcher }).models(
      'zenmux',
      undefined,
      'must-not-leave-server',
    );
    expect(result.models[0]?.pricing).toEqual(pricing);
    expect(result.catalogPublic).toBe(true);
    expect(publicRequest).toBe(true);
  });

  it('includes cache, reasoning, request and image fees in the conservative ZenMux quote', async () => {
    const token = (value: string) => ({ value, unit: 'perMTokens', currency: 'USD' });
    const request = (value: string) => ({ value, unit: 'perCount', currency: 'USD' });
    const fetcher = reply(
      JSON.stringify({
        data: [
          {
            id: 'priced/model',
            pricings: {
              prompt: [token('0.15')],
              completion: [token('0.6')],
              input_cache_read: [token('0.03')],
              input_cache_write: [token('0.3')],
              input_cache_write_1_h: [token('0.6')],
              input_cache_write_5_min: [token('0.45')],
              internal_reasoning: [token('0.2')],
              request: [request('0.001')],
              image: [request('0.02')],
            },
          },
        ],
      }),
    );
    const catalog = await createAiClient({ allowedBaseUrls: [], fetch: fetcher }).models('zenmux');
    expect(catalog.models[0]?.pricing).toEqual({
      inputUsdPerMillion: '1.08',
      outputUsdPerMillion: '0.8',
      requestUsd: '0.001',
      imageUsd: '0.02',
    });
  });

  it('converts OpenRouter per-token scientific decimals exactly and distinguishes advertised free prices from missing prices', async () => {
    const fetcher = reply(
      '{"data":[{"id":"priced","pricing":{"prompt":1.5e-7,"completion":"0.0000006","request":"0.001"}},' +
        '{"id":"free","pricing":{"prompt":"0","completion":"0"}},{"id":"unknown","pricing":{"prompt":"0"}}]}',
    );
    const result = await createAiClient({ allowedBaseUrls: [], fetch: fetcher }).models('openrouter');
    expect(result.models.map((item) => item.pricing)).toEqual([
      { ...pricing, requestUsd: '0.001' },
      { inputUsdPerMillion: '0', outputUsdPerMillion: '0', requestUsd: '0', imageUsd: '0' },
      null,
    ]);
  });

  it('does not infer prices for a custom OpenAI catalog and refuses unapproved custom egress', async () => {
    const fetcher = reply('{"data":[{"id":"local-model"}]}');
    const client = createAiClient({ allowedBaseUrls: ['http://127.0.0.1:11434/v1'], fetch: fetcher });
    const result = await client.models('custom', 'http://127.0.0.1:11434/v1', 'fixture-key');
    expect(result.models[0]?.pricing).toBeNull();
    expect(result.catalogPublic).toBe(false);
    await expect(client.models('custom', 'http://127.0.0.1:11434/admin', 'fixture-key')).rejects.toMatchObject({
      code: 'AI_EGRESS_DENIED',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('bounded authenticated completions', () => {
  it('preserves a numeric 18-place USD charge and sends numeric provider price ceilings', async () => {
    const fetcher = vi.fn<typeof fetch>((_url, init) => {
      if (typeof init?.body !== 'string') return Promise.resolve(new Response('', { status: 400 }));
      const body = z
        .object({ provider: z.object({ max_price: z.object({ prompt: z.number() }) }), max_tokens: z.literal(32) })
        .safeParse(JSON.parse(init.body));
      if (new Headers(init.headers).get('Authorization') !== 'Bearer fixture-private-key' || !body.success)
        return Promise.resolve(new Response('', { status: 400 }));
      return Promise.resolve(
        new Response(
          '{"choices":[{"message":{"content":"OK"}}],"usage":{"prompt_tokens":12,"completion_tokens":1,"cost":0.000000000000123456}}',
        ),
      );
    });
    const result = await createAiClient({ allowedBaseUrls: [], fetch: fetcher }).complete(completion());
    expect(result).toMatchObject({
      status: 'ok',
      costUsd: '0.000000000000123456',
      inputTokens: 12,
      outputTokens: 1,
      content: 'OK',
    });
  });

  it('returns only safe error metadata for a 401, without reading or forwarding the provider body', async () => {
    const result = await createAiClient({
      allowedBaseUrls: [],
      fetch: vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response('fixture-private-key A private prompt revoked', { status: 401 })),
      ),
    }).complete(completion());
    expect(result).toMatchObject({
      status: 'error',
      httpStatus: 401,
      errorCode: 'http_401',
      costUsd: null,
      content: null,
    });
    expect(JSON.stringify(result)).not.toMatch(/fixture-private-key|A private prompt/);
  });

  it('keeps reported charges when the answer is malformed, and missing billing is unknown rather than free', async () => {
    const malformed = await createAiClient({
      allowedBaseUrls: [],
      fetch: reply('{"usage":{"cost":"0.004","prompt_tokens":42}}'),
    }).complete(completion());
    expect(malformed).toMatchObject({
      status: 'error',
      errorCode: 'invalid_response',
      costUsd: '0.004',
      inputTokens: 42,
    });
    const unknown = await createAiClient({
      allowedBaseUrls: [],
      fetch: reply('{"choices":[{"message":{"content":"OK"}}]}'),
    }).complete(completion());
    expect(unknown).toMatchObject({ status: 'ok', costUsd: null, inputTokens: null, outputTokens: null });
  });

  it('aborts at the configured deadline and sanitizes native network exceptions', async () => {
    const slow = vi.fn<typeof fetch>((_url, init) => {
      const { promise, reject } = Promise.withResolvers<Response>();
      init?.signal?.addEventListener(
        'abort',
        () => {
          reject(new Error('fixture-private-key timeout'));
        },
        { once: true },
      );
      return promise;
    });
    const timed = await createAiClient({ allowedBaseUrls: [], timeoutMs: 10, fetch: slow }).complete(completion());
    expect(timed).toMatchObject({ status: 'timeout', httpStatus: null, errorCode: 'timeout', costUsd: null });
    const network = await createAiClient({
      allowedBaseUrls: [],
      fetch: vi.fn<typeof fetch>(() => Promise.reject(new Error('fixture-private-key'))),
    }).complete(completion());
    expect(network).toMatchObject({ status: 'error', errorCode: 'network', costUsd: null });
    expect(JSON.stringify(network)).not.toContain('fixture-private-key');
  });
});
