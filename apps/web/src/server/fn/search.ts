// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Server functions of ⌘K (FR-S4): grouped search, "Baru dibuka", and remembering what the user opened. The user
 * always comes from the session.
 */
import { createServerFn } from '@tanstack/react-start';
import * as z from 'zod';
import { RECENT_ENTITY_KINDS, SEARCH_QUERY_MAX, type RecentEntry, type SearchResults } from '../../lib/search.ts';
import { attempt, requireSession, type Result } from '../access.ts';
import { services } from '../runtime.ts';
import { recentFor, searchFor } from '../search.ts';

/** FR-S4: transactions, accounts, categories, and tags matching `query`, a few per group with the total. */
export const searchEverything = createServerFn({ method: 'GET' })
  .validator(z.object({ query: z.string().trim().min(1).max(SEARCH_QUERY_MAX) }))
  .handler(async ({ context, data }): Promise<Result<SearchResults>> => {
    const ledger = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, ledger.now());
      return searchFor(ledger, user.id, data.query);
    });
  });

/** FR-S4 "Baru dibuka": what the user opened last. */
export const listRecent = createServerFn({ method: 'GET' })
  .validator(z.object({}))
  .handler(async ({ context }): Promise<Result<RecentEntry[]>> => {
    const ledger = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, ledger.now());
      return recentFor(ledger, user.id);
    });
  });

/** Remembers that the user opened an entity (by id) or a page (by path) for "Baru dibuka". */
export const touchRecent = createServerFn({ method: 'POST' })
  .validator(
    z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('page'), ref: z.string().regex(/^\/[\w\-/]{0,199}$/) }),
      z.object({ kind: z.enum(RECENT_ENTITY_KINDS), ref: z.uuid() }),
    ]),
  )
  .handler(async ({ context, data }): Promise<Result<null>> => {
    const { recentItems, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      await recentItems.touch(user.id, data.kind, data.ref);
      return null;
    });
  });
