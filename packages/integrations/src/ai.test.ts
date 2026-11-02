// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi, type Mock } from 'vitest';
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

  it('prices a custom catalog only from published prices and refuses unapproved custom egress', async () => {
    const fetcher = reply(
      '{"data":[{"id":"local-model"},{"id":"priced-model","pricing":{"prompt":"0.000001","completion":"0.000002"}}]}',
    );
    const client = createAiClient({ allowedBaseUrls: ['http://127.0.0.1:11434/v1'], fetch: fetcher });
    const result = await client.models('custom', 'http://127.0.0.1:11434/v1', 'fixture-key');
    expect(result.models.map((item) => item.pricing)).toEqual([
      null,
      { inputUsdPerMillion: '1', outputUsdPerMillion: '2', requestUsd: '0', imageUsd: '0' },
    ]);
    expect(result.catalogPublic).toBe(false);
    await expect(client.models('custom', 'http://127.0.0.1:11434/admin', 'fixture-key')).rejects.toMatchObject({
      code: 'AI_EGRESS_DENIED',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('uses conservative override maxima and rounds subquantum provider prices upward', async () => {
    const catalog = await createAiClient({
      allowedBaseUrls: [],
      fetch: reply(
        JSON.stringify({
          data: [
            {
              id: 'quoted',
              pricing: {
                prompt: '1e-25',
                completion: '0',
                overrides: [
                  { pricing: { prompt: '0.000002', completion: '0.000003', request: '0.1' } },
                  { prompt: '0.000001', completion: '0.000004', image: '0.2' },
                ],
              },
            },
            { id: 'subquantum', pricing: { prompt: '1e-25', completion: '0' } },
          ],
        }),
      ),
    }).models('openrouter');
    expect(catalog.models[0]?.pricing).toEqual({
      inputUsdPerMillion: '2',
      outputUsdPerMillion: '4',
      requestUsd: '0.1',
      imageUsd: '0.2',
    });
    expect(catalog.models[1]?.pricing?.inputUsdPerMillion).toBe('0.000000000001');
  });

  it.each([
    { prompt: [], completion: [] },
    { prompt: 'not an array', completion: [] },
    { completion: [{ value: '1', currency: 'USD', unit: 'perMTokens' }] },
    { prompt: [{ value: '1', currency: 'EUR', unit: 'perMTokens' }], completion: [] },
    { prompt: [{ value: '1', currency: 'USD', unit: 'perCount' }], completion: [] },
    { prompt: [{ value: '-1', currency: 'USD', unit: 'perMTokens' }], completion: [] },
    ...[
      'completion',
      'input_cache_read',
      'input_cache_write',
      'input_cache_write_1_h',
      'input_cache_write_5_min',
      'internal_reasoning',
      'request',
      'image',
    ].map((key) => ({
      prompt: [{ value: '1', currency: 'USD', unit: 'perMTokens' }],
      completion: [{ value: '1', currency: 'USD', unit: 'perMTokens' }],
      [key]: [],
    })),
  ])('treats malformed ZenMux pricing as unknown, never free: %j', async (pricings) => {
    const catalog = await createAiClient({
      allowedBaseUrls: [],
      fetch: reply(JSON.stringify({ data: [{ id: 'unknown', pricings }] })),
    }).models('zenmux');
    expect(catalog.models[0]?.pricing).toBeNull();
  });

  it.each([
    { prompt: '100000000000000000000', completion: '0' },
    { prompt: 'NaN', completion: '0' },
    ...['input_cache_read', 'input_cache_write', 'internal_reasoning', 'request', 'image'].map((key) => ({
      prompt: '0',
      completion: '0',
      [key]: '-1',
    })),
  ])('refuses unsafe or corrupt OpenRouter quotes: %j', async (quote) => {
    const catalog = await createAiClient({
      allowedBaseUrls: [],
      fetch: reply(JSON.stringify({ data: [{ id: 'unknown', pricing: quote }] })),
    }).models('openrouter');
    expect(catalog.models[0]?.pricing).toBeNull();
  });

  it('omits unsafe model IDs and fails closed on private catalogs without a key or on HTTP errors', async () => {
    const fetcher = reply('{"data":[{},{"id":"bad id"},{"id":"valid","display_name":"Valid"}]}');
    const client = createAiClient({ allowedBaseUrls: ['https://custom.test/v1'], fetch: fetcher });
    await expect(client.models('custom', 'https://custom.test/v1')).rejects.toMatchObject({
      code: 'AI_NOT_CONFIGURED',
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect((await client.models('openrouter')).models.map((model) => model.id)).toEqual(['valid']);
    fetcher.mockResolvedValueOnce(new Response('private key diagnostic', { status: 503 }));
    await expect(client.models('openrouter')).rejects.toMatchObject({ code: 'AI_PROVIDER_FAILED' });
  });

  it('drops every model that is not text in, text out; a catalog without modalities counts as text', async () => {
    const priced = { prompt: '0.000001', completion: '0.000002' };
    const openrouter = await createAiClient({
      allowedBaseUrls: [],
      fetch: reply(
        JSON.stringify({
          data: [
            {
              id: 'chat',
              pricing: priced,
              architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
            },
            {
              id: 'painter',
              pricing: priced,
              architecture: { input_modalities: ['text'], output_modalities: ['image'] },
            },
            {
              id: 'mixed',
              pricing: priced,
              architecture: { input_modalities: ['text'], output_modalities: ['text', 'audio'] },
            },
            {
              id: 'embed',
              pricing: priced,
              architecture: { input_modalities: ['text'], output_modalities: ['embeddings'] },
            },
            {
              id: 'listener',
              pricing: priced,
              architecture: { input_modalities: ['audio'], output_modalities: ['text'] },
            },
            { id: 'unlabelled', pricing: priced },
          ],
        }),
      ),
    }).models('openrouter');
    expect(openrouter.models.map((model) => model.id)).toEqual(['chat', 'unlabelled']);
    const zenmux = await createAiClient({
      allowedBaseUrls: [],
      fetch: reply(
        JSON.stringify({
          data: [
            { id: 'chat', input_modalities: ['text'], output_modalities: ['text'] },
            { id: 'video', input_modalities: ['text'], output_modalities: ['video'] },
            { id: 'rerank', input_modalities: ['text'], output_modalities: ['rerank'] },
          ],
        }),
      ),
    }).models('zenmux');
    expect(zenmux.models.map((model) => model.id)).toEqual(['chat']);
    const custom = await createAiClient({
      allowedBaseUrls: ['https://custom.test/v1'],
      fetch: reply('{"data":[{"id":"local"}]}'),
    }).models('custom', 'https://custom.test/v1', 'fixture-key');
    expect(custom.models.map((model) => model.id)).toEqual(['local']);
  });

  it('reads reasoning and tool support from each catalog', async () => {
    const openrouter = await createAiClient({
      allowedBaseUrls: [],
      fetch: reply(
        JSON.stringify({
          data: [
            { id: 'plain', supported_parameters: ['tools', 'max_tokens'] },
            { id: 'optional', reasoning: { mandatory: false }, supported_parameters: ['tools', 'reasoning'] },
            { id: 'mandatory', reasoning: { mandatory: true }, supported_parameters: ['reasoning'] },
            { id: 'unknown' },
          ],
        }),
      ),
    }).models('openrouter');
    expect(openrouter.models.map(({ id, reasoning, tools }) => ({ id, reasoning, tools }))).toEqual([
      { id: 'plain', reasoning: 'none', tools: true },
      { id: 'optional', reasoning: 'optional', tools: true },
      { id: 'mandatory', reasoning: 'mandatory', tools: false },
      { id: 'unknown', reasoning: 'none', tools: null },
    ]);
    const zenmux = await createAiClient({
      allowedBaseUrls: [],
      fetch: reply(
        JSON.stringify({
          data: [
            { id: 'reasoner', capabilities: { reasoning: true } },
            { id: 'plain', capabilities: { reasoning: false } },
            { id: 'bare' },
          ],
        }),
      ),
    }).models('zenmux');
    expect(zenmux.models.map(({ id, reasoning, tools }) => ({ id, reasoning, tools }))).toEqual([
      { id: 'reasoner', reasoning: 'optional', tools: null },
      { id: 'plain', reasoning: 'none', tools: null },
      { id: 'bare', reasoning: 'none', tools: null },
    ]);
    const custom = await createAiClient({
      allowedBaseUrls: ['https://custom.test/v1'],
      fetch: reply('{"data":[{"id":"local","reasoning":{"mandatory":true},"supported_parameters":[]}]}'),
    }).models('custom', 'https://custom.test/v1', 'fixture-key');
    expect(custom.models[0]).toMatchObject({ reasoning: 'none', tools: null });
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

  it('normalizes structured and absent arguments without confusing them with malformed names', async () => {
    const fetcher = reply(
      JSON.stringify({
        choices: [
          {
            message: {
              content: 'ok',
              tool_calls: [
                { id: 'one', function: { name: 'pengeluaran', arguments: { from: '2026-10-01' } } },
                { id: 'two', function: { name: 'pengeluaran' } },
                { id: 'three', function: { name: 'pengeluaran', arguments: null } },
              ],
            },
          },
        ],
      }),
    );
    const result = await createAiClient({ allowedBaseUrls: [], fetch: fetcher }).complete(
      completion({
        provider: 'zenmux',
        messages: [
          { role: 'assistant', content: 'Checking', toolCalls: [{ id: 'old', name: 'pengeluaran', arguments: '{}' }] },
          { role: 'tool', content: 'No data' },
        ],
      }),
    );
    expect(result.toolCalls.map((call) => call.arguments)).toEqual(['{"from":"2026-10-01"}', '{}', '{}']);
    const body = fetcher.mock.calls[0]?.[1]?.body;
    if (typeof body !== 'string') throw new TypeError('Expected a JSON request body');
    const sent = JSON.parse(body) as { messages: unknown[]; provider?: unknown };
    expect(sent.messages).toMatchObject([{ content: 'Checking' }, { tool_call_id: '', content: 'No data' }]);
    expect(sent.provider).toBeUndefined();
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

  it.each([0, -1, 1.5, 32769])('rejects unsafe output bounds before authenticated egress: %s', async (maxTokens) => {
    const fetcher = reply('{}');
    await expect(
      createAiClient({ allowedBaseUrls: [], fetch: fetcher }).complete(completion({ maxTokens })),
    ).rejects.toMatchObject({ code: 'AI_INVALID_CONFIG' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('contains malformed, missing, oversized, and broken transport bodies without forwarding private text', async () => {
    const bodies = [null, 'private not JSON', 'x'.repeat(8 * 1024 * 1024 + 1)];
    for (const body of bodies) {
      const result = await createAiClient({
        allowedBaseUrls: [],
        fetch: () => Promise.resolve(new Response(body)),
      }).complete(completion());
      expect(result).toMatchObject({ status: 'error', httpStatus: 200, errorCode: 'invalid_response', content: null });
    }
    const broken = new ReadableStream({
      start(controller) {
        controller.enqueue('not binary');
      },
      cancel() {
        throw new Error('private cancellation');
      },
    });
    const result = await createAiClient({
      allowedBaseUrls: [],
      fetch: () => Promise.resolve(new Response(broken)),
    }).complete(completion());
    expect(result).toMatchObject({ status: 'error', errorCode: 'invalid_response' });
  });
});

describe('structured outputs', () => {
  const responseSchema = {
    name: 'gmail_extraction',
    schema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } },
  };
  const sentBodies = (fetcher: Mock<typeof fetch>) =>
    fetcher.mock.calls.map(([, init]) => JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as unknown);
  const answer = () => Response.json({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] });

  it('sends a strict json_schema response_format next to the unchanged OpenRouter provider block', async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(answer()));
    const result = await createAiClient({ allowedBaseUrls: [], fetch: fetcher }).complete(
      completion({ responseSchema }),
    );
    expect(result).toMatchObject({ status: 'ok', content: '{"ok":true}' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sentBodies(fetcher)[0]).toMatchObject({
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'gmail_extraction', strict: true, schema: responseSchema.schema },
      },
      provider: { allow_fallbacks: false, require_parameters: true },
    });
  });

  it.each([400, 404, 422])(
    'retries exactly once without response_format when the provider refuses it with %s',
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response('private refusal', { status }))
        .mockResolvedValueOnce(answer());
      const result = await createAiClient({ allowedBaseUrls: [], fetch: fetcher }).complete(
        completion({ responseSchema }),
      );
      expect(result).toMatchObject({ status: 'ok', httpStatus: 200, content: '{"ok":true}' });
      expect(fetcher).toHaveBeenCalledTimes(2);
      const [first, second] = sentBodies(fetcher);
      expect(first).toHaveProperty('response_format');
      expect(second).not.toHaveProperty('response_format');
      expect(second).toMatchObject({ model: 'fixture/model', provider: { require_parameters: true } });
    },
  );

  it('returns the second refusal as an error instead of retrying again', async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(new Response('', { status: 404 })));
    const result = await createAiClient({ allowedBaseUrls: [], fetch: fetcher }).complete(
      completion({ responseSchema }),
    );
    expect(result).toMatchObject({ status: 'error', httpStatus: 404, errorCode: 'http_404', content: null });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not retry other failures, or refusals of a request without a schema', async () => {
    const failing = vi.fn<typeof fetch>(() => Promise.resolve(new Response('', { status: 500 })));
    expect(
      await createAiClient({ allowedBaseUrls: [], fetch: failing }).complete(completion({ responseSchema })),
    ).toMatchObject({ status: 'error', errorCode: 'http_500' });
    expect(failing).toHaveBeenCalledTimes(1);
    const refused = vi.fn<typeof fetch>(() => Promise.resolve(new Response('', { status: 404 })));
    expect(await createAiClient({ allowedBaseUrls: [], fetch: refused }).complete(completion())).toMatchObject({
      status: 'error',
      errorCode: 'http_404',
    });
    expect(refused).toHaveBeenCalledTimes(1);
    expect(sentBodies(refused)[0]).not.toHaveProperty('response_format');
  });

  it('refuses a schema combined with tools or badly named before egress', async () => {
    const fetcher = reply('{}');
    const client = createAiClient({ allowedBaseUrls: [], fetch: fetcher });
    const tools = [{ name: 'ringkasan_anggaran', description: 'Budget summary', parameters: { type: 'object' } }];
    await expect(client.complete(completion({ responseSchema, tools }))).rejects.toMatchObject({
      code: 'AI_INVALID_CONFIG',
    });
    await expect(
      client.complete(completion({ responseSchema: { ...responseSchema, name: 'bad name' } })),
    ).rejects.toMatchObject({ code: 'AI_INVALID_CONFIG' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('reasoning control', () => {
  const sentBody = (fetcher: Mock<typeof fetch>) => {
    const body = fetcher.mock.calls[0]?.[1]?.body;
    return JSON.parse(typeof body === 'string' ? body : '{}') as Record<string, unknown>;
  };
  const ok = () => Response.json({ choices: [{ message: { content: 'OK' }, finish_reason: 'stop' }] });

  it.each(['openrouter', 'zenmux'] as const)('switches reasoning off for %s only when asked', async (provider) => {
    const off = vi.fn<typeof fetch>(() => Promise.resolve(ok()));
    await createAiClient({ allowedBaseUrls: [], fetch: off }).complete(
      completion({ provider, disableReasoning: true }),
    );
    expect(sentBody(off)).toMatchObject({ reasoning: { enabled: false } });
    for (const disableReasoning of [undefined, false]) {
      const plain = vi.fn<typeof fetch>(() => Promise.resolve(ok()));
      await createAiClient({ allowedBaseUrls: [], fetch: plain }).complete(
        completion({ provider, ...(disableReasoning === undefined ? {} : { disableReasoning }) }),
      );
      expect(sentBody(plain)).not.toHaveProperty('reasoning');
    }
  });

  it('never sends the reasoning switch to a custom endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(ok()));
    await createAiClient({ allowedBaseUrls: ['https://custom.test/v1'], fetch: fetcher }).complete(
      completion({ provider: 'custom', baseUrl: 'https://custom.test/v1', disableReasoning: true }),
    );
    expect(sentBody(fetcher)).not.toHaveProperty('reasoning');
  });

  it('fails an answer cut off while mostly reasoning, keeping its metering', async () => {
    const answer = (finish: string, reasoning: number, completionTokens = 300) =>
      reply(
        JSON.stringify({
          choices: [{ message: { content: null }, finish_reason: finish }],
          usage: {
            prompt_tokens: 20,
            completion_tokens: completionTokens,
            completion_tokens_details: { reasoning_tokens: reasoning },
            cost: '0.0003',
          },
        }),
      );
    const exhausted = await createAiClient({ allowedBaseUrls: [], fetch: answer('length', 150) }).complete(
      completion(),
    );
    expect(exhausted).toMatchObject({
      status: 'error',
      httpStatus: 200,
      errorCode: 'reasoning_exhausted',
      inputTokens: 20,
      outputTokens: 300,
      costUsd: '0.0003',
      content: null,
      finishReason: 'length',
    });
    // Mostly answer text, a finished answer, or no tokens reported: an ordinary result for the caller to judge.
    for (const fetcher of [answer('length', 149), answer('stop', 300), answer('length', 0, 0)]) {
      expect(await createAiClient({ allowedBaseUrls: [], fetch: fetcher }).complete(completion())).toMatchObject({
        status: 'ok',
        errorCode: null,
      });
    }
  });
});
