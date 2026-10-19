// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Shared read server functions of the ledger screens (M1): accounts with balances, categories, tags, and the
 * reference exchange rate. The user always comes from the session.
 */
import { createServerFn } from '@tanstack/react-start';
import type { AccountsOverview } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import type { ReferenceRate } from '@wf/db/fx-rates';
import type { TagView } from '@wf/db/tags';
import * as z from 'zod';
import { attempt, requireSession, type Result } from '../access.ts';
import { services } from '../runtime.ts';

const currency = z.string().regex(/^[A-Z]{3}$/);

/** FR-R1/R2: the user's accounts with balances and flags, and the available balance in the base currency. */
export const listAccounts = createServerFn({ method: 'GET' })
  .validator(z.object({ status: z.enum(['active', 'archived', 'all']).optional() }))
  .handler(async ({ context, data }): Promise<Result<AccountsOverview>> => {
    const { accounts, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return accounts.list(user.id, data.status === undefined ? {} : { status: data.status });
    });
  });

/** FR-K1: the user's categories (built-ins created on first use). */
export const listCategories = createServerFn({ method: 'GET' })
  .validator(z.object({ includeArchived: z.boolean().optional() }))
  .handler(async ({ context, data }): Promise<Result<CategoryView[]>> => {
    const { categories, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return categories.list(user.id, { includeArchived: data.includeArchived ?? false });
    });
  });

/** FR-K3: the user's tags with usage counts; `query` narrows them for `#` autocomplete. */
export const listTags = createServerFn({ method: 'GET' })
  .validator(z.object({ query: z.string().max(64).optional() }))
  .handler(async ({ context, data }): Promise<Result<TagView[]>> => {
    const { tags, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return tags.list(user.id, data.query === undefined ? {} : { query: data.query });
    });
  });

/** FR-T4: the reference rate for a pair (the user's manual rate first, then the latest built-in one), or `null`. */
export const getReferenceRate = createServerFn({ method: 'GET' })
  .validator(z.object({ base: currency, quote: currency }))
  .handler(async ({ context, data }): Promise<Result<ReferenceRate | null>> => {
    const { fxRates, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return fxRates.referenceRate(user.id, data.base, data.quote);
    });
  });
