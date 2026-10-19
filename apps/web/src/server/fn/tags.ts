// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › Tag (FR-K3): create, rename, merge (old slugs become aliases), delete, and the likely duplicates to
 * suggest merging. The user always comes from the session; input is normalized by the repository
 * (`#Dana Darurat` → `dana-darurat`).
 */
import { createServerFn } from '@tanstack/react-start';
import type { TagPair, TagView } from '@wf/db/tags';
import * as z from 'zod';
import { attempt, requireSession, type Result } from '../access.ts';
import { services } from '../runtime.ts';

const id = z.uuid();
/** Raw input as typed; the repository normalizes it and refuses one without letters or digits. */
const input = z.string().min(1).max(64);

export const createTag = createServerFn({ method: 'POST' })
  .validator(z.object({ input }))
  .handler(async ({ context, data }): Promise<Result<TagView>> => {
    const { tags, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return tags.create(user.id, data.input);
    });
  });

export const renameTag = createServerFn({ method: 'POST' })
  .validator(z.object({ id, input }))
  .handler(async ({ context, data }): Promise<Result<TagView>> => {
    const { tags, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return tags.rename(user.id, data.id, data.input);
    });
  });

/**
 * "Gabungkan tag": every source merges into the target, one after another (each merge is atomic; a failure stops
 * the rest). Returns the target with its new usage count and aliases.
 */
export const mergeTags = createServerFn({ method: 'POST' })
  .validator(
    z
      .object({ sourceIds: z.array(id).min(1).max(50), targetId: id })
      .refine(
        (data) => !data.sourceIds.includes(data.targetId) && new Set(data.sourceIds).size === data.sourceIds.length,
      ),
  )
  .handler(async ({ context, data }): Promise<Result<TagView>> => {
    const { tags, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      let target: TagView | undefined;
      for (const sourceId of data.sourceIds) target = await tags.merge(user.id, sourceId, data.targetId);
      return target as TagView;
    });
  });

export const deleteTag = createServerFn({ method: 'POST' })
  .validator(z.object({ id }))
  .handler(async ({ context, data }): Promise<Result<null>> => {
    const { tags, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      await tags.remove(user.id, data.id);
      return null;
    });
  });

/** "3 tag terlihat sama": slug pairs that are probably the same tag. */
export const listSimilarTags = createServerFn({ method: 'GET' })
  .validator(z.object({}))
  .handler(async ({ context }): Promise<Result<TagPair[]>> => {
    const { tags, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return tags.similar(user.id);
    });
  });
