// SPDX-License-Identifier: AGPL-3.0-only
import type { RequestContext } from './request-middleware.ts';
import { serveQueueBoard } from './queue-access.ts';
import { services } from './runtime.ts';

/** The GET handler of `/admin/queues` and everything below it. */
export async function handleQueueBoard({ request, context }: { request: Request; context: RequestContext }) {
  const { queueBoard, now } = await services();
  return serveQueueBoard(request, {
    session: context.session,
    board: queueBoard,
    now,
    nonce: context.nonce,
    locale: context.preferences.locale,
  });
}
