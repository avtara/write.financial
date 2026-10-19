// SPDX-License-Identifier: AGPL-3.0-only
import path from 'node:path';
import type { AppControllerRoute, BullBoardRequest } from '@bull-board/api/typings/app';
import { describe, expect, it, vi } from 'vitest';
// `vi.mock` calls are hoisted above this import.
import { assetsOf, createQueueBoard, entryPage, escapeHtml, queueBoardHandler, WebAdapter } from './queue-board.ts';

const created = vi.hoisted(() => ({ queues: [] as { name: string; opts: unknown }[], errors: [] as Error[] }));

// No Valkey here: a stand-in queue that Bull Board accepts (it checks `metaValues.version`), on a connection that
// reports one error.
vi.mock('bullmq', () => ({
  Queue: class {
    readonly metaValues = { version: 'bullmq:6' };
    readonly name: string;
    readonly opts: unknown;
    constructor(name: string, opts: unknown) {
      this.name = name;
      this.opts = opts;
      created.queues.push({ name, opts });
    }
  },
}));
vi.mock('ioredis', () => ({
  Redis: class {
    readonly options: unknown;
    constructor(_url: string, options: unknown) {
      this.options = options;
    }
    on(_event: string, listener: (error: Error) => void) {
      listener(new Error('connection refused'));
    }
  },
}));

const TEMPLATE = `<link href="static/css/main.1.css" rel="stylesheet"></head>
<script defer src="static/js/lib.2.js"></script><script defer src="static/js/main.3.js"></script>`;

function route(overrides: Partial<AppControllerRoute> = {}): AppControllerRoute {
  return {
    method: 'get',
    route: '/api/queues/:queueName/:jobId',
    spec: { summary: 'job', response: 'GetJobResponse' },
    handler: vi.fn((request?: BullBoardRequest) => ({
      status: 200,
      body: { params: request?.params, query: request?.query },
    })),
    ...overrides,
  } as AppControllerRoute;
}

function board(routes: AppControllerRoute[] = [route()], files: Record<string, string> = {}) {
  const adapter = new WebAdapter()
    .setViewsPath('/ui/dist')
    .setStaticPath('/static', '/ui/dist/static')
    .setUIConfig({ boardTitle: 'Antrean <wf>' })
    .setEntryRoute()
    .setQueues(new Map())
    .setApiRoutes(routes);
  const readAsset = vi.fn((file: string) =>
    file in files ? Promise.resolve(Buffer.from(files[file] ?? '')) : Promise.reject(new Error('ENOENT')),
  );
  return { adapter, readAsset, handler: queueBoardHandler({ adapter, readAsset }) };
}

const get = (pathname: string, init?: RequestInit) => new Request(`https://uang.example${pathname}`, init);

describe('escapeHtml and assetsOf', () => {
  it('escapes markup characters and finds the built asset names', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&#60;a href=&#34;x&#34;&#62;&#39;&#38;&#39;&#60;/a&#62;');
    expect(assetsOf(TEMPLATE)).toEqual({
      scripts: ['static/js/lib.2.js', 'static/js/main.3.js'],
      styles: ['static/css/main.1.css'],
    });
  });
});

describe('entryPage', () => {
  it('nonces every script, escapes the config, and has no inline styles or external fonts', () => {
    const page = entryPage({
      basePath: '/admin/queues',
      nonce: 'abc',
      uiConfig: { boardTitle: '</script><b>' },
      scripts: ['static/js/a.js'],
      styles: ['static/css/a.css'],
    });
    expect(page).toContain('<base href="/admin/queues/">');
    expect(page).toContain('<script defer nonce="abc" src="static/js/a.js"></script>');
    expect(page).toContain('<link rel="stylesheet" href="static/css/a.css">');
    expect(page).toContain('{"boardTitle":"\\u003c/script\\u003e\\u003cb\\u003e"}');
    expect(page).toContain('<title>&#60;/script&#62;&#60;b&#62;</title>');
    expect(page).not.toMatch(/style=|<style|googleapis/);
    expect(entryPage({ basePath: '/q', nonce: 'n', uiConfig: {}, scripts: [], styles: [] })).toContain(
      '<title>Bull Board</title>',
    );
  });
});

describe('WebAdapter', () => {
  it('keeps only GET routes, for every path they declare', () => {
    const { adapter } = board([
      route({ method: ['get', 'post'], route: ['/api/a', '/api/b'] }),
      route({ method: 'put', route: '/api/c' }),
    ]);
    expect(adapter.routes.map((r) => r.pattern.source)).toEqual(['^\\/api\\/a$', '^\\/api\\/b$']);
  });

  it('has a default error handler until Bull Board installs its own', () => {
    expect(new WebAdapter().errorHandler(new Error('boom'))).toEqual({ status: 500, body: { error: 'boom' } });
  });
});

describe('queueBoardHandler', () => {
  it('answers GET only', async () => {
    const response = await board().handler.handle(get('/admin/queues', { method: 'POST' }), 'n');
    expect(response.status).toBe(405);
  });

  it('renders the entry page with the request nonce, reading the template once', async () => {
    const { handler, readAsset } = board([], { '/ui/dist/index.ejs': TEMPLATE });
    for (const pathname of ['/admin/queues', '/admin/queues/']) {
      const response = await handler.handle(get(pathname), 'n1');
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(await response.text()).toContain('<script defer nonce="n1" src="static/js/main.3.js">');
    }
    expect(readAsset).toHaveBeenCalledTimes(1);
  });

  it('serves known static files from the static directory only', async () => {
    const file = path.resolve('/ui/dist/static', 'js/main.3.js');
    const { handler } = board([], { [file]: 'console.log(1)' });
    const ok = await handler.handle(get('/admin/queues/static/js/main.3.js'), 'n');
    expect(ok.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(await ok.text()).toBe('console.log(1)');
    expect((await handler.handle(get('/admin/queues/static/js/missing.js'), 'n')).status).toBe(404);
    expect((await handler.handle(get('/admin/queues/static/js/main.3.map'), 'n')).status).toBe(404);
    expect((await handler.handle(get('/admin/queues/static/%2e%2e/index.ejs'), 'n')).status).toBe(404);
  });

  it('runs matching API routes with decoded params and the query', async () => {
    const { handler } = board();
    const response = await handler.handle(get('/admin/queues/api/queues/mainten%20ance/7?status=failed'), 'n');
    expect(await response.json()).toEqual({
      params: { queueName: 'mainten ance', jobId: '7' },
      query: { status: 'failed' },
    });
    expect((await handler.handle(get('/admin/queues/api/unknown'), 'n')).status).toBe(404);
  });

  it('answers 204 without a body and maps thrown errors through the error handler', async () => {
    const { handler, adapter } = board([
      route({ route: '/api/empty', handler: () => ({ status: 204, body: {} }) }),
      route({ route: '/api/fails', handler: () => Promise.reject(new Error('redis down')) }),
      route({ route: '/api/odd', handler: vi.fn().mockRejectedValue('text') }),
      route({ route: '/api/default', handler: () => ({ body: { fine: true } }) }),
    ]);
    adapter.setErrorHandler((error) => ({ body: { error: error.message } }));
    const empty = await handler.handle(get('/admin/queues/api/empty'), 'n');
    expect(empty.status).toBe(204);
    const fails = await handler.handle(get('/admin/queues/api/fails'), 'n');
    expect(fails.status).toBe(500);
    expect(await fails.json()).toEqual({ error: 'redis down' });
    expect(await (await handler.handle(get('/admin/queues/api/odd'), 'n')).json()).toEqual({ error: 'text' });
    const fine = await handler.handle(get('/admin/queues/api/default'), 'n');
    expect(fine.status).toBe(200);
    adapter.setErrorHandler(() => ({ status: 400, body: { error: 'bad' } }));
    expect((await handler.handle(get('/admin/queues/api/fails'), 'n')).status).toBe(400);
  });

  it('reads assets from disk by default', async () => {
    const { adapter } = board([]);
    adapter.setStaticPath('/static', path.resolve('apps/web/public'));
    const response = await queueBoardHandler({ adapter }).handle(get('/admin/queues/static/favicon.svg'), 'n');
    expect(response.headers.get('content-type')).toBe('image/svg+xml');
  });
});

describe('createQueueBoard', () => {
  it('registers every enqueueable queue read-only and serves the real Bull Board UI', async () => {
    const logger = { error: vi.fn() };
    const queueBoard = createQueueBoard({ redis: 'redis://127.0.0.1:6379', logger });
    const connection = expect.anything() as unknown;
    expect(created.queues).toEqual([
      { name: 'maintenance', opts: { connection, prefix: 'wf' } },
      { name: 'fx', opts: { connection, prefix: 'wf' } },
    ]);
    const err = expect.any(Error) as unknown;
    expect(logger.error).toHaveBeenCalledWith({ err }, 'queue board redis connection error');
    const page = await (await queueBoard.handle(get('/admin/queues'), 'n0nce')).text();
    expect(page).toMatch(/<script defer nonce="n0nce" src="static\/js\/main\.[0-9a-f]+\.js">/);
    expect(page).toContain('"boardTitle":"write.financial"');
    const queues = await (await queueBoard.handle(get('/admin/queues/static/favicon-32x32.png'), 'n')).arrayBuffer();
    expect(queues.byteLength).toBeGreaterThan(0);
  });
});
