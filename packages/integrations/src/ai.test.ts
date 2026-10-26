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

describe('bounded tool calling', () => {
  const tools = [
    {
      name: 'ringkasan_anggaran',
      description: 'Budget lines.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  ];

  it('sends the tool definitions, round-trips a tool result, and parses the calls', async () => {
    let sent: unknown;
    const fetcher = vi.fn<typeof fetch>((_url, init) => {
      sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
      return Promise.resolve(
        Response.json({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  { id: 'call_1', type: 'function', function: { name: 'ringkasan_anggaran', arguments: '{}' } },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 40, completion_tokens: 8, cost: '0.0002' },
        }),
      );
    });
    const messages = [
      { role: 'user' as const, content: 'Berapa sisa anggaran Makan?' },
      { role: 'assistant' as const, content: '', toolCalls: [{ id: 'call_0', name: 'pengeluaran', arguments: '{}' }] },
      { role: 'tool' as const, content: '{"total":1}', toolCallId: 'call_0' },
    ];
    const result = await createAiClient({ allowedBaseUrls: [], fetch: fetcher }).complete(
      completion({ messages, tools, maxTokens: 256 }),
    );
    expect(sent).toMatchObject({
      tools: [{ type: 'function', function: { name: 'ringkasan_anggaran', parameters: { type: 'object' } } }],
      tool_choice: 'auto',
      messages: [
        { role: 'user', content: 'Berapa sisa anggaran Makan?' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_0', type: 'function' }] },
        { role: 'tool', tool_call_id: 'call_0', content: '{"total":1}' },
      ],
    });
    expect(result).toMatchObject({
      status: 'ok',
      content: null,
      finishReason: 'tool_calls',
      costUsd: '0.0002',
      toolCalls: [{ id: 'call_1', name: 'ringkasan_anggaran', arguments: '{}' }],
    });
  });

  it('drops malformed and oversized calls instead of executing them', async () => {
    const call = (entry: unknown) => ({ choices: [{ message: { content: 'ok', tool_calls: [entry] } }] });
    const names = await createAiClient({
      allowedBaseUrls: [],
      fetch: reply(JSON.stringify(call({ id: 'x', function: { name: 'Drop-Table', arguments: '{}' } }))),
    }).complete(completion({ tools }));
    expect(names.toolCalls).toEqual([]);
    const oversized = await createAiClient({
      allowedBaseUrls: [],
      fetch: reply(JSON.stringify(call({ id: 'x', function: { name: 'pengeluaran', arguments: 'x'.repeat(8_193) } }))),
    }).complete(completion({ tools }));
    expect(oversized.toolCalls).toEqual([]);
    const notAnArray = await createAiClient({
      allowedBaseUrls: [],
      fetch: reply('{"choices":[{"message":{"content":"ok","tool_calls":"nope"}}]}'),
    }).complete(completion({ tools }));
    expect(notAnArray).toMatchObject({ status: 'ok', toolCalls: [] });
  });

  it('refuses a tool surface that is too large or badly named', async () => {
    const client = createAiClient({ allowedBaseUrls: [], fetch: reply('{}') });
    const tooMany = Array.from({ length: 9 }, (_unused, index) => ({
      name: `tool_${index}`,
      description: '',
      parameters: {},
    }));
    await expect(client.complete(completion({ tools: tooMany }))).rejects.toMatchObject({ code: 'AI_INVALID_CONFIG' });
    await expect(
      client.complete(completion({ tools: [{ name: 'Bad Name', description: '', parameters: {} }] })),
    ).rejects.toMatchObject({ code: 'AI_INVALID_CONFIG' });
  });
});

describe('bounded authenticated completions', () => {
  it('sends bounded inline WebP vision parts and refuses PDFs or assistant-attached images before egress', async () => {
    const fetcher = vi.fn<typeof fetch>((_url, init) => {
      const body = z
        .object({
          messages: z.array(
            z.object({
              role: z.literal('user'),
              content: z.array(
                z.union([
                  z.object({ type: z.literal('text'), text: z.string() }),
                  z.object({
                    type: z.literal('image_url'),
                    image_url: z.object({ url: z.literal('data:image/webp;base64,AQID') }),
                  }),
                ]),
              ),
            }),
          ),
        })
        .safeParse(JSON.parse(typeof init?.body === 'string' ? init.body : 'null'));
      return Promise.resolve(
        body.success
          ? Response.json({ choices: [{ message: { content: '{"amountMinor":"96500"}' } }] })
          : new Response('', { status: 400 }),
      );
    });
    const client = createAiClient({ allowedBaseUrls: [], fetch: fetcher });
    const images = [{ mime: 'image/webp' as const, bytes: new Uint8Array([1, 2, 3]) }];
    expect(
      await client.complete(completion({ messages: [{ role: 'user', content: 'Read receipt', images }] })),
    ).toMatchObject({ status: 'ok', content: '{"amountMinor":"96500"}' });
    await expect(
      client.complete(completion({ messages: [{ role: 'assistant', content: '', images }] })),
    ).rejects.toMatchObject({ code: 'AI_INVALID_CONFIG' });
    await expect(
      client.complete(
        completion({
          messages: [
            {
              role: 'user',
              content: '',
              images: Array.from({ length: 5 }, () => images[0] as (typeof images)[number]),
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: 'AI_INVALID_CONFIG' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
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
