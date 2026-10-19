// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › Kategori (FR-K1/K2): create, edit, move to another group, merge, archive, unarchive, delete, and
 * reorder categories. The user always comes from the session; the repository enforces system categories
 * (`CATEGORY_SYSTEM`) and the groups of each kind.
 */
import { createServerFn } from '@tanstack/react-start';
import type { CategoryView } from '@wf/db/categories';
import { CATEGORY_GROUPS, CATEGORY_NAME_MAX } from '@wf/domain/categories';
import * as z from 'zod';
import { isColor } from '../../lib/colors.ts';
import { attempt, requireSession, type Result } from '../access.ts';
import { services } from '../runtime.ts';

const id = z.uuid();
const name = z.string().trim().min(1).max(CATEGORY_NAME_MAX);
/** A lucide icon name (`shopping-bag`). */
const icon = z
  .string()
  .max(40)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const color = z.string().refine(isColor);
const group = z.enum(CATEGORY_GROUPS);

/** FR-K1: a new expense or income category ("Biaya keuangan" is the system group, not user-made). */
export const createCategory = createServerFn({ method: 'POST' })
  .validator(
    z.object({ kind: z.enum(['expense', 'income']), group, name, icon, color, isFixed: z.boolean().default(false) }),
  )
  .handler(async ({ context, data }): Promise<Result<CategoryView>> => {
    const { categories, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return categories.create(user.id, data);
    });
  });

/** FR-K2 "Edit kategori": name (not for built-ins), icon, color, and the fixed-cost flag. */
export const updateCategory = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      id,
      name: name.optional(),
      icon: icon.optional(),
      color: color.optional(),
      isFixed: z.boolean().optional(),
    }),
  )
  .handler(async ({ context, data }): Promise<Result<CategoryView>> => {
    const { categories, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return categories.update(user.id, data.id, {
        ...(data.name === undefined ? {} : { name: data.name }),
        ...(data.icon === undefined ? {} : { icon: data.icon }),
        ...(data.color === undefined ? {} : { color: data.color }),
        ...(data.isFixed === undefined ? {} : { isFixed: data.isFixed }),
      });
    });
  });

/** FR-K2 "Pindah ke Kebutuhan". */
export const moveCategory = createServerFn({ method: 'POST' })
  .validator(z.object({ id, group }))
  .handler(async ({ context, data }): Promise<Result<CategoryView>> => {
    const { categories, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return categories.move(user.id, data.id, data.group);
    });
  });

/** FR-K2 "Gabungkan dengan…": the source's transactions move to the target and the source is deleted. */
export const mergeCategories = createServerFn({ method: 'POST' })
  .validator(z.object({ sourceId: id, targetId: id }))
  .handler(async ({ context, data }): Promise<Result<{ readonly moved: number }>> => {
    const { categories, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return categories.merge(user.id, data.sourceId, data.targetId);
    });
  });

/** FR-K2 "Arsipkan": hidden from pickers, history kept. */
export const archiveCategory = createServerFn({ method: 'POST' })
  .validator(z.object({ id }))
  .handler(async ({ context, data }): Promise<Result<CategoryView>> => {
    const { categories, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return categories.archive(user.id, data.id);
    });
  });

export const unarchiveCategory = createServerFn({ method: 'POST' })
  .validator(z.object({ id }))
  .handler(async ({ context, data }): Promise<Result<CategoryView>> => {
    const { categories, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return categories.unarchive(user.id, data.id);
    });
  });

/** FR-K2 "Hapus kategori": its transactions become uncategorized ("Perlu kategori"). */
export const deleteCategory = createServerFn({ method: 'POST' })
  .validator(z.object({ id }))
  .handler(async ({ context, data }): Promise<Result<{ readonly uncategorized: number }>> => {
    const { categories, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      return categories.remove(user.id, data.id);
    });
  });

/** "Seret untuk mengubah urutan": the new order of one kind and group. */
export const reorderCategories = createServerFn({ method: 'POST' })
  .validator(z.object({ ids: z.array(id).min(1).max(200) }))
  .handler(async ({ context, data }): Promise<Result<null>> => {
    const { categories, now } = await services();
    return attempt(async () => {
      const { user } = await requireSession(context.session, {}, now());
      await categories.reorder(user.id, data.ids);
      return null;
    });
  });
