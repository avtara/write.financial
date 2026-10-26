// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The E2E server's fake AI provider (the BYOK gateway behind the Assistant and Settings › AI agent): preloaded into the
 * production server (`node --import ./e2e/ai-fetch.ts`, after `e2e/market-fetch.ts`, see `playwright.config.ts`), it
 * answers every request to an AI provider's host (`AI_BASE_URLS` in `@wf/domain/ai`) itself, so E2E runs never reach a
 * real model and need no real key. It speaks the OpenAI-compatible wire shape `@wf/integrations/ai` expects:
 * - `/models`: a one-model catalog with prices (the "Muat daftar model" button),
 * - `/chat/completions`: a deterministic two-step tool loop. A question mentioning GoPay proposes one `draf_transaksi`
 *   draft whose account ("GoPay"), category ("Makan & Dapur") and day come from the request's own system prompt, so the
 *   ids are always the asking user's real ones, and the amount from the question (default 45.000); a question about
 *   spending calls `pengeluaran` for the question's month; once the messages contain a tool result, the stub answers
 *   with the final text, quoting what the tool returned (the draft confirmation, or the spending total). A request
 *   without tools is the connection test and answers "OK".
 * Every other AI-host request answers 401. All other hosts keep the fetch the previous preload installed.
 */
const realFetch = globalThis.fetch;
const AI_HOSTS: ReadonlySet<string> = new Set(['openrouter.ai', 'zenmux.ai']);

const CATALOG = {
  data: [
    {
      id: 'e2e/test-model',
      name: 'E2E Test Model',
      context_length: 8192,
      pricing: { prompt: '0.000001', completion: '0.000002', request: '0', image: '0' },
    },
  ],
};

/** `16500000` → `16.500.000` (the app's Indonesian grouping for whole minor units). */
const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** The id of the account or category `name` in the request's own system prompt (`- <id> | <name> (<group>)`). */
function idFromPrompt(system: string, name: string): string {
  for (const line of system.split('\n')) {
    const match = /^- (\S+) \| (.+) \((\w+)\)$/.exec(line);
    if (match?.[2] === name) return match[1] ?? '';
  }
  return '';
}

/** The end of `today`'s month (`2026-10-15` → `2026-10-31`). */
function monthEnd(today: string): string {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  return `${today.slice(0, 7)}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
}

interface ChatMessage {
  readonly role?: unknown;
  readonly content?: unknown;
}

interface ChatBody {
  readonly model?: unknown;
  readonly messages?: unknown;
  readonly tools?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The messages' shapes the adapter sends; anything else leaves the corresponding string empty. */
function chatBodyOf(raw: string): { body: ChatBody; system: string; question: string; toolResult: string | null } {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) throw new TypeError('not a chat completion body');
  const messages = Array.isArray(parsed['messages']) ? (parsed['messages'] as readonly ChatMessage[]) : [];
  const system = messages.find((message) => message.role === 'system')?.content;
  const question = [...messages].reverse().find((message) => message.role === 'user')?.content;
  const toolResult = [...messages].reverse().find((message) => message.role === 'tool')?.content;
  return {
    body: parsed,
    system: typeof system === 'string' ? system : '',
    question: typeof question === 'string' ? question : '',
    toolResult: typeof toolResult === 'string' ? toolResult : null,
  };
}

function chat(raw: string): Response {
  const { body, system, question, toolResult } = chatBodyOf(raw);
  const model = typeof body['model'] === 'string' ? body['model'] : '';
  const usage = { prompt_tokens: 512, completion_tokens: 48, total_tokens: 560, cost: '0.0004' };
  const envelope = (message: Record<string, unknown>, finishReason: string): Response =>
    Response.json({
      id: 'chatcmpl-e2e',
      object: 'chat.completion',
      created: 0,
      model,
      choices: [{ index: 0, message, finish_reason: finishReason }],
      usage,
    });
  const answer = (content: string): Response => envelope({ role: 'assistant', content }, 'stop');
  const toolCall = (name: string, args: unknown): Response =>
    envelope(
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call-e2e-1', type: 'function', function: { name, arguments: JSON.stringify(args) } }],
      },
      'tool_calls',
    );

  // Second step: the loop already ran a tool; answer from what it returned.
  if (toolResult !== null) {
    let output: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(toolResult);
      if (isRecord(parsed)) output = parsed;
    } catch {
      return answer('Selesai.');
    }
    if (output['draft'] !== undefined) return answer('Siap, ini draftnya. Periksa dulu sebelum disimpan:');
    const total = output['total'];
    if (typeof total === 'string') {
      const daily = typeof output['averageDaily'] === 'string' ? group(output['averageDaily']) : '0';
      const from = typeof output['from'] === 'string' ? output['from'] : '';
      const to = typeof output['to'] === 'string' ? output['to'] : '';
      return answer(`Pengeluaran ${from}–${to} total Rp${group(total)} · rata-rata harian Rp${daily}.`);
    }
    return answer('Selesai.');
  }
  // No tools: the connection test ("Reply with OK").
  if (!Array.isArray(body['tools']) || body['tools'].length === 0) return answer('OK');

  const today = /Today is (\d{4}-\d{2}-\d{2})/.exec(system)?.[1] ?? '2026-10-15';
  if (/gopay/i.test(question)) {
    const amount = /(\d[\d.]*)\s*(?:rp\s*)?gopay/i.exec(question.trim())?.[1]?.replaceAll('.', '') || '45000';
    return toolCall('draf_transaksi', {
      type: 'expense',
      description: 'GoPay',
      amount,
      accountId: idFromPrompt(system, 'GoPay'),
      categoryId: idFromPrompt(system, 'Makan & Dapur'),
      date: today,
      time: '12:10',
      tags: [],
    });
  }
  if (/pengeluaran|oktober|october/i.test(question)) {
    return toolCall('pengeluaran', { from: `${today.slice(0, 7)}-01`, to: monthEnd(today) });
  }
  return answer('Di lingkungan uji ini saya hanya menjawab soal GoPay dan pengeluaran.');
}

globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!AI_HOSTS.has(url.hostname)) return realFetch(input, init);
  if (url.pathname.endsWith('/models')) return Promise.resolve(Response.json(CATALOG));
  if (!url.pathname.endsWith('/chat/completions')) {
    return Promise.resolve(Response.json({ error: 'Not found' }, { status: 404 }));
  }
  const raw = init?.body;
  if (typeof raw !== 'string') return Promise.resolve(Response.json({ error: 'Bad request' }, { status: 400 }));
  try {
    return Promise.resolve(chat(raw));
  } catch {
    return Promise.resolve(Response.json({ error: 'Bad request' }, { status: 400 }));
  }
};
