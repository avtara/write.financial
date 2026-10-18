// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Bull Board (plan §8 M0, §10 monitoring) over the queues of `@wf/jobs`, served by the web process at
 * {@link QUEUE_BOARD_PATH} for admins (the route checks who may see it).
 *
 * Read-only: every queue is registered with `readOnlyMode`, and this adapter answers only GET requests, so no
 * request can retry, clean, pause, or add jobs; that also leaves nothing for a cross-site request to change.
 *
 * Content Security Policy: the entry page is generated here instead of from Bull Board's template, so every script
 * carries the request nonce, the loading placeholder has no inline styles, and no Google Fonts stylesheet is loaded.
 * Two exceptions apply on this path alone (`security.ts`, `queueBoard`): `base-uri 'self'`, because Bull Board's
 * client reads its API base from `<base href>`, and `style-src 'self' 'unsafe-inline'`, because its React UI inserts
 * `<style>` elements and `style` attributes without the nonce. Scripts still need the nonce.
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import type {
  AppControllerRoute,
  BullBoardQueues,
  ControllerHandlerReturnType,
  IServerAdapter,
  UIConfig,
} from '@bull-board/api/typings/app';
import { JOBS, QUEUE_PREFIX, type JobQueue } from '@wf/jobs/queues';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUE_BOARD_PATH } from './security.ts';

export interface QueueBoard {
  /** Answers a request below {@link QUEUE_BOARD_PATH}; `nonce` is the request's CSP nonce. */
  handle: (request: Request, nonce: string) => Promise<Response>;
}

interface ApiRoute {
  readonly pattern: RegExp;
  readonly keys: readonly string[];
  readonly handler: AppControllerRoute['handler'];
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** `/api/queues/:queueName/:jobId` → a regex with one group per parameter. */
function compileRoute(route: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = route
    .split('/')
    .map((part) => {
      if (!part.startsWith(':')) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      keys.push(part.slice(1));
      return '([^/]+)';
    })
    .join('/');
  return { pattern: new RegExp(`^${source}$`), keys };
}

/** Text for HTML content or a quoted attribute. */
export const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** The `IServerAdapter` Bull Board fills in; it collects the routes and settings instead of mounting them. */
export class WebAdapter implements IServerAdapter {
  queues: BullBoardQueues = new Map();
  staticDir = '';
  viewsDir = '';
  uiConfig: UIConfig = {};
  readonly routes: ApiRoute[] = [];
  errorHandler: (error: Error) => ControllerHandlerReturnType = (error) => ({
    status: 500,
    body: { error: error.message },
  });

  setQueues(queues: BullBoardQueues): this {
    this.queues = queues;
    return this;
  }
  setViewsPath(viewsPath: string): this {
    this.viewsDir = viewsPath;
    return this;
  }
  setStaticPath(_route: string, staticPath: string): this {
    this.staticDir = staticPath;
    return this;
  }
  setEntryRoute(): this {
    // The entry page is rendered by `entryPage`, with the request nonce.
    return this;
  }
  setErrorHandler(handler: (error: Error) => ControllerHandlerReturnType): this {
    this.errorHandler = handler;
    return this;
  }
  setApiRoutes(routes: AppControllerRoute[]): this {
    for (const route of routes) {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      if (!methods.includes('get')) continue;
      for (const pathname of Array.isArray(route.route) ? route.route : [route.route]) {
        this.routes.push({ ...compileRoute(pathname), handler: (request) => route.handler(request) });
      }
    }
    return this;
  }
  setUIConfig(config: UIConfig): this {
    this.uiConfig = config;
    return this;
  }
}

/** Bull Board's built entry template lists its hashed asset files; reuse those names, not the markup. */
export function assetsOf(template: string): { scripts: string[]; styles: string[] } {
  return {
    scripts: [...template.matchAll(/<script[^>]*\ssrc="(static\/[^"]+\.js)"/g)].map((match) => match[1] as string),
    styles: [...template.matchAll(/<link[^>]*\shref="(static\/[^"]+\.css)"/g)].map((match) => match[1] as string),
  };
}

export function entryPage(options: {
  readonly basePath: string;
  readonly nonce: string;
  readonly uiConfig: UIConfig;
  readonly scripts: readonly string[];
  readonly styles: readonly string[];
}): string {
  const { basePath, nonce, uiConfig, scripts, styles } = options;
  const config = JSON.stringify(uiConfig).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  const title = escapeHtml(uiConfig.boardTitle ?? 'Bull Board');
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<base href="${escapeHtml(basePath)}/">`,
    `<title>${title}</title>`,
    '<link rel="icon" type="image/svg+xml" href="static/images/logo.svg">',
    ...styles.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`),
    '</head>',
    '<body>',
    `<script id="__UI_CONFIG__" type="application/json">${config}</script>`,
    '<div id="root"></div>',
    ...scripts.map((src) => `<script defer nonce="${escapeHtml(nonce)}" src="${escapeHtml(src)}"></script>`),
    '</body>',
    '</html>',
  ].join('\n');
}

const json = (body: unknown, status: number) => Response.json(body, { status });

export interface QueueBoardOptions {
  readonly adapter: WebAdapter;
  /** Defaults to reading the files from disk. */
  readonly readAsset?: (file: string) => Promise<Buffer>;
}

/** The request handler over a Bull Board that has been registered on `adapter`. */
export function queueBoardHandler({ adapter, readAsset = (file) => readFile(file) }: QueueBoardOptions): QueueBoard {
  let assets: Promise<{ scripts: string[]; styles: string[] }> | undefined;

  return {
    handle: async (request, nonce) => {
      if (request.method !== 'GET') return json({ error: 'Bull Board is read-only' }, 405);
      const url = new URL(request.url);
      const sub = url.pathname.slice(QUEUE_BOARD_PATH.length);

      if (sub === '' || sub === '/') {
        assets ??= readAsset(path.join(adapter.viewsDir, 'index.ejs')).then((file) => assetsOf(file.toString('utf8')));
        const page = entryPage({ basePath: QUEUE_BOARD_PATH, nonce, uiConfig: adapter.uiConfig, ...(await assets) });
        return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }

      if (sub.startsWith('/static/')) {
        const root = path.resolve(adapter.staticDir);
        const file = path.resolve(root, `.${decodeURIComponent(sub.slice('/static'.length))}`);
        const type = CONTENT_TYPES[path.extname(file)];
        if (!file.startsWith(`${root}${path.sep}`) || type === undefined) return json({ error: 'Not found' }, 404);
        try {
          return new Response(new Uint8Array(await readAsset(file)), { headers: { 'content-type': type } });
        } catch {
          return json({ error: 'Not found' }, 404);
        }
      }

      for (const route of adapter.routes) {
        const match = route.pattern.exec(sub);
        if (match === null) continue;
        // Every parameter group is non-optional, so a match fills all of them.
        const params = Object.fromEntries(
          route.keys.map((key, index) => [key, decodeURIComponent(match[index + 1] as string)]),
        );
        try {
          const result = await route.handler({
            queues: adapter.queues,
            uiConfig: adapter.uiConfig,
            params,
            query: Object.fromEntries(url.searchParams),
            body: {},
            headers: Object.fromEntries(request.headers),
          });
          return result.status === 204 ? new Response(null, { status: 204 }) : json(result.body, result.status ?? 200);
        } catch (error) {
          const result = adapter.errorHandler(error instanceof Error ? error : new Error(String(error)));
          return json(result.body, result.status ?? 500);
        }
      }
      return json({ error: 'Not found' }, 404);
    },
  };
}

export interface CreateQueueBoardOptions {
  /** `config.redis.url`. */
  readonly redis: string;
  readonly logger: { error: (fields: Record<string, unknown>, message: string) => void };
}

/** Registers every enqueueable queue (`JOBS`) read-only on a new board. */
export function createQueueBoard({ redis: url, logger }: CreateQueueBoardOptions): QueueBoard {
  // BullMQ requires `maxRetriesPerRequest: null` on its connection; it connects on the first command.
  const connection = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null });
  connection.on('error', (error: Error) => {
    logger.error({ err: error }, 'queue board redis connection error');
  });
  const adapter = new WebAdapter();
  createBullBoard({
    queues: (Object.keys(JOBS) as JobQueue[]).map(
      (name) => new BullMQAdapter(new Queue(name, { connection, prefix: QUEUE_PREFIX }), { readOnlyMode: true }),
    ),
    serverAdapter: adapter,
    options: {
      // Resolved from this module, so the traced copy in `.output/server/node_modules` is found (vite.config.ts).
      uiBasePath: path.dirname(createRequire(import.meta.url).resolve('@bull-board/ui/package.json')),
      uiConfig: { boardTitle: 'write.financial', hideDocsLink: true, locale: { lng: 'en-US' } },
    },
  });
  return queueBoardHandler({ adapter });
}
