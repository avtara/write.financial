// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Categories (FR-K1/K2): the built-in catalog (stored with its key as the name, `system:food`), user categories,
 * and the category menu (edit, move group, merge, archive, delete). Deleting soft-deletes the row, so a deleted
 * built-in is never re-created, and its transactions land in "Perlu kategori" (uncategorized) with one
 * `category_deleted` Review item each (FR-L7).
 */
import {
  BUILT_IN_CATEGORIES,
  BUILT_IN_PREFIX,
  CATEGORY_NAME_MAX,
  GROUPS_BY_KIND,
  type BuiltInCategoryKey,
  type CategoryGroup,
  type CategoryKind,
} from '@wf/domain/categories';
import type { Dek } from '@wf/crypto/envelope';
import { and, asc, eq, inArray, isNotNull, isNull, like, sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { firstRow, withUser, type Database, type Transaction } from './db.ts';
import { logActivity } from './activity.ts';
import { LedgerError } from './ledger-errors.ts';
import { insertReviewItemIn } from './review-items.ts';
import { categories, postings, transactions } from './schema.ts';

export interface CategoryView {
  readonly id: string;
  readonly kind: CategoryKind;
  readonly group: CategoryGroup;
  /** The key for built-in categories (render via `builtInKey`), otherwise the name as typed. */
  readonly name: string;
  readonly builtInKey: BuiltInCategoryKey | null;
  readonly icon: string;
  readonly color: string;
  readonly sortOrder: number;
  readonly isFixed: boolean;
  readonly isSystem: boolean;
  readonly archivedAt: Date | null;
  /** Non-deleted transactions in the category plus fee / FX-difference postings charged to it. */
  readonly transactionCount: number;
}

export interface CategoryInput {
  readonly kind: CategoryKind;
  readonly group: CategoryGroup;
  /** 1–24 characters after trimming; may not start with `system:`. */
  readonly name: string;
  readonly icon: string;
  readonly color: string;
  readonly isFixed?: boolean;
}

export type CategoryPatch = Partial<Pick<CategoryInput, 'name' | 'icon' | 'color' | 'isFixed'>>;

export interface CategoriesRepository {
  /** Live categories (built-ins ensured first), by kind, group, order, name. Archived ones only on request. */
  list: (userId: string, options?: { readonly includeArchived?: boolean }) => Promise<CategoryView[]>;
  /** Inserts the catalog entries the user never had (deleted built-ins stay deleted); returns how many. */
  ensureBuiltIns: (userId: string) => Promise<number>;
  /** @throws {LedgerError} `INVALID_CATEGORY`, `CATEGORY_NAME_TAKEN` */
  create: (userId: string, input: CategoryInput) => Promise<CategoryView>;
  /**
   * Built-in categories keep their name (it is translated by the UI); everything else can change.
   * @throws {LedgerError} `NOT_FOUND`, `INVALID_CATEGORY`, `CATEGORY_NAME_TAKEN`
   */
  update: (userId: string, id: string, patch: CategoryPatch) => Promise<CategoryView>;
  /** @throws {LedgerError} `NOT_FOUND`, `CATEGORY_SYSTEM`, `INVALID_CATEGORY` (group of another kind) */
  move: (userId: string, id: string, group: CategoryGroup) => Promise<CategoryView>;
  /**
   * Moves every transaction and fee posting of `sourceId` to `targetId` and deletes the source. Returns the number
   * of non-deleted transactions moved.
   * @throws {LedgerError} `NOT_FOUND`, `INVALID_CATEGORY` (same category), `CATEGORY_KIND_MISMATCH`, `CATEGORY_SYSTEM`
   */
  merge: (userId: string, sourceId: string, targetId: string) => Promise<{ readonly moved: number }>;
  /** @throws {LedgerError} `NOT_FOUND`, `CATEGORY_SYSTEM` */
  archive: (userId: string, id: string) => Promise<CategoryView>;
  /** @throws {LedgerError} `NOT_FOUND` */
  unarchive: (userId: string, id: string) => Promise<CategoryView>;
  /**
   * FR-K2: soft-deletes the category; its transactions become uncategorized (returns how many non-deleted ones), and
   * each of those gets a `category_deleted` Review item ("Perlu kategori"; returns how many were created).
   * @throws {LedgerError} `NOT_FOUND`, `CATEGORY_SYSTEM`
   */
  remove: (userId: string, id: string) => Promise<{ readonly uncategorized: number; readonly reviewItems: number }>;
  /** New order of categories of one kind and group. @throws {LedgerError} `NOT_FOUND`, `INVALID_CATEGORY` */
  reorder: (userId: string, ids: readonly string[]) => Promise<void>;
}

const BUILT_IN_KEYS = new Set<string>(BUILT_IN_CATEGORIES.map((entry) => entry.key));

function checkName(input: string): string {
  const name = input.trim();
  if (name.length === 0 || name.length > CATEGORY_NAME_MAX || name.toLowerCase().startsWith(BUILT_IN_PREFIX)) {
    throw new LedgerError('INVALID_CATEGORY', 'A category name has 1–24 characters and no system: prefix');
  }
  return name;
}

/** A unique violation of the name index becomes `CATEGORY_NAME_TAKEN`. */
function nameTaken(error: unknown): never {
  if (
    error instanceof Error &&
    error.cause instanceof postgres.PostgresError &&
    error.cause.code === '23505' &&
    error.cause.constraint_name === 'categories_name_key'
  ) {
    throw new LedgerError('CATEGORY_NAME_TAKEN');
  }
  throw error;
}

const LIVE = isNull(categories.deletedAt);
const LIVE_TRANSACTION = isNull(transactions.deletedAt);

async function viewsIn(tx: Transaction, where: SQL | undefined): Promise<CategoryView[]> {
  const used = tx
    .select({ categoryId: transactions.categoryId, count: sql<string>`count(*)`.as('used_count') })
    .from(transactions)
    .where(and(LIVE_TRANSACTION, isNotNull(transactions.categoryId)))
    .groupBy(transactions.categoryId)
    .as('used');
  const charged = tx
    .select({ categoryId: postings.categoryId, count: sql<string>`count(*)`.as('charged_count') })
    .from(postings)
    .innerJoin(transactions, and(eq(transactions.id, postings.transactionId), LIVE_TRANSACTION))
    .where(isNotNull(postings.categoryId))
    .groupBy(postings.categoryId)
    .as('charged');
  const rows = await tx
    .select({
      id: categories.id,
      kind: categories.kind,
      group: categories.group,
      name: categories.name,
      icon: categories.icon,
      color: categories.color,
      sortOrder: categories.sortOrder,
      isFixed: categories.isFixed,
      isSystem: categories.isSystem,
      archivedAt: categories.archivedAt,
      transactionCount: sql<number>`(coalesce(${used.count}, 0) + coalesce(${charged.count}, 0))::int`.mapWith(Number),
    })
    .from(categories)
    .leftJoin(used, eq(used.categoryId, categories.id))
    .leftJoin(charged, eq(charged.categoryId, categories.id))
    .where(and(LIVE, where))
    .orderBy(asc(categories.kind), asc(categories.group), asc(categories.sortOrder), asc(categories.name));
  return rows.map((row) => ({
    ...row,
    builtInKey: BUILT_IN_KEYS.has(row.name) ? (row.name as BuiltInCategoryKey) : null,
  }));
}

async function viewIn(tx: Transaction, id: string): Promise<CategoryView> {
  const [view] = await viewsIn(tx, eq(categories.id, id));
  if (view === undefined) throw new LedgerError('NOT_FOUND', 'No such category');
  return view;
}

async function ensureBuiltInsIn(tx: Transaction, userId: string): Promise<number> {
  // Deleted rows count: a built-in the user deleted is not brought back.
  const existing = await tx
    .select({ name: categories.name })
    .from(categories)
    .where(like(categories.name, `${BUILT_IN_PREFIX}%`));
  const known = new Set(existing.map((row) => row.name));
  const missing = BUILT_IN_CATEGORIES.filter((entry) => !known.has(entry.key));
  if (missing.length === 0) return 0;
  const inserted = await tx
    .insert(categories)
    .values(
      missing.map((entry) => ({
        userId,
        kind: entry.kind,
        group: entry.group,
        name: entry.key,
        icon: entry.icon,
        color: entry.color,
        isFixed: entry.isFixed,
        isSystem: entry.isSystem,
        sortOrder: BUILT_IN_CATEGORIES.indexOf(entry),
      })),
    )
    .onConflictDoNothing()
    .returning({ id: categories.id });
  return inserted.length;
}

/** The next `sort_order` within a kind and group. */
async function nextSortOrderIn(tx: Transaction, kind: CategoryKind, group: CategoryGroup): Promise<number> {
  const rows = await tx
    .select({ next: sql<number>`coalesce(max(${categories.sortOrder}) + 1, 0)::int`.mapWith(Number) })
    .from(categories)
    .where(and(eq(categories.kind, kind), eq(categories.group, group)));
  return firstRow(rows, 'categories').next;
}

function checkGroup(kind: CategoryKind, group: CategoryGroup): void {
  if (!GROUPS_BY_KIND[kind].includes(group)) {
    throw new LedgerError('INVALID_CATEGORY', `Group ${group} does not fit kind ${kind}`);
  }
}

/** A live, non-system category (system ones cannot be moved, merged away, archived, or deleted). */
async function changeableIn(tx: Transaction, id: string): Promise<CategoryView> {
  const category = await viewIn(tx, id);
  if (category.isSystem) throw new LedgerError('CATEGORY_SYSTEM');
  return category;
}

export function createCategories(
  db: Database,
  { getDek }: { getDek: (userId: string) => Promise<Dek> },
): CategoriesRepository {
  return {
    list: (userId, { includeArchived = false } = {}) =>
      withUser(db, userId, async (tx) => {
        await ensureBuiltInsIn(tx, userId);
        return viewsIn(tx, includeArchived ? undefined : isNull(categories.archivedAt));
      }),

    ensureBuiltIns: (userId) => withUser(db, userId, (tx) => ensureBuiltInsIn(tx, userId)),

    create: (userId, input) =>
      withUser(db, userId, async (tx) => {
        const name = checkName(input.name);
        checkGroup(input.kind, input.group);
        const { id } = firstRow(
          await tx
            .insert(categories)
            .values({
              userId,
              kind: input.kind,
              group: input.group,
              name,
              icon: input.icon,
              color: input.color,
              isFixed: input.isFixed ?? false,
              sortOrder: await nextSortOrderIn(tx, input.kind, input.group),
            })
            .returning({ id: categories.id }),
          'categories',
        );
        await logActivity(tx, userId, 'category', [id], 'created');
        return viewIn(tx, id);
      }).catch(nameTaken),

    update: (userId, id, patch) =>
      withUser(db, userId, async (tx) => {
        const category = await viewIn(tx, id);
        const values: CategoryPatch = {
          ...(patch.name === undefined ? {} : { name: checkName(patch.name) }),
          ...(patch.icon === undefined ? {} : { icon: patch.icon }),
          ...(patch.color === undefined ? {} : { color: patch.color }),
          ...(patch.isFixed === undefined ? {} : { isFixed: patch.isFixed }),
        };
        if (values.name !== undefined && category.builtInKey !== null) {
          throw new LedgerError('INVALID_CATEGORY', 'Built-in categories cannot be renamed');
        }
        const fields = Object.keys(values);
        if (fields.length > 0) await tx.update(categories).set(values).where(eq(categories.id, id));
        await logActivity(tx, userId, 'category', [id], 'updated', { fields });
        return viewIn(tx, id);
      }).catch(nameTaken),

    move: (userId, id, group) =>
      withUser(db, userId, async (tx) => {
        const category = await changeableIn(tx, id);
        checkGroup(category.kind, group);
        if (group !== category.group) {
          const sortOrder = await nextSortOrderIn(tx, category.kind, group);
          await tx.update(categories).set({ group, sortOrder }).where(eq(categories.id, id));
          await logActivity(tx, userId, 'category', [id], 'updated', { fields: ['group'] });
        }
        return viewIn(tx, id);
      }),

    merge: (userId, sourceId, targetId) =>
      withUser(db, userId, async (tx) => {
        if (sourceId === targetId) throw new LedgerError('INVALID_CATEGORY', 'A category cannot merge into itself');
        const source = await viewIn(tx, sourceId);
        const target = await viewIn(tx, targetId);
        if (source.kind !== target.kind) throw new LedgerError('CATEGORY_KIND_MISMATCH');
        if (source.isSystem) throw new LedgerError('CATEGORY_SYSTEM');
        // Soft-deleted transactions move too, so an Undo restores them into the surviving category.
        const moved = await tx
          .update(transactions)
          .set({ categoryId: targetId })
          .where(eq(transactions.categoryId, sourceId))
          .returning({ deletedAt: transactions.deletedAt });
        await tx.update(postings).set({ categoryId: targetId }).where(eq(postings.categoryId, sourceId));
        await tx.update(categories).set({ deletedAt: new Date() }).where(eq(categories.id, sourceId));
        await logActivity(tx, userId, 'category', [sourceId, targetId], 'merged', { from: sourceId, into: targetId });
        return { moved: moved.filter((row) => row.deletedAt === null).length };
      }),

    archive: (userId, id) =>
      withUser(db, userId, async (tx) => {
        const category = await changeableIn(tx, id);
        if (category.archivedAt === null) {
          await tx.update(categories).set({ archivedAt: new Date() }).where(eq(categories.id, id));
          await logActivity(tx, userId, 'category', [id], 'archived');
        }
        return viewIn(tx, id);
      }),

    unarchive: (userId, id) =>
      withUser(db, userId, async (tx) => {
        const category = await viewIn(tx, id);
        if (category.archivedAt !== null) {
          await tx.update(categories).set({ archivedAt: null }).where(eq(categories.id, id));
          await logActivity(tx, userId, 'category', [id], 'restored');
        }
        return viewIn(tx, id);
      }),

    remove: async (userId, id) => {
      // Fetched first: getDek opens its own transaction.
      const dek = await getDek(userId);
      return withUser(db, userId, async (tx) => {
        const category = await changeableIn(tx, id);
        const cleared = await tx
          .update(transactions)
          .set({ categoryId: null })
          .where(eq(transactions.categoryId, id))
          .returning({ id: transactions.id, localDate: transactions.localDate, deletedAt: transactions.deletedAt });
        await tx.update(postings).set({ categoryId: null }).where(eq(postings.categoryId, id));
        await tx.update(categories).set({ deletedAt: new Date() }).where(eq(categories.id, id));
        await logActivity(tx, userId, 'category', [id], 'deleted');
        const live = cleared.filter((row) => row.deletedAt === null);
        let reviewItems = 0;
        for (const row of live) {
          const { created } = await insertReviewItemIn(tx, userId, dek, {
            reason: 'category_deleted',
            source: 'system',
            dedupeKey: `catdel.${id}.${row.id}`,
            subjectTransactionId: row.id,
            dueDate: row.localDate,
            payload: {
              kind: 'category',
              transactionId: row.id,
              previousCategoryId: id,
              previousCategoryName: category.name,
            },
          });
          reviewItems += Number(created);
        }
        return { uncategorized: live.length, reviewItems };
      });
    },

    reorder: (userId, ids) =>
      withUser(db, userId, async (tx) => {
        if (ids.length === 0) return;
        const rows = await tx
          .select({ id: categories.id, kind: categories.kind, group: categories.group })
          .from(categories)
          .where(and(LIVE, inArray(categories.id, [...ids])));
        // `inArray` ignores duplicates, so a repeated id also fails the length check.
        if (rows.length !== ids.length) throw new LedgerError('NOT_FOUND', 'No such category');
        if (new Set(rows.map((row) => `${row.kind}/${row.group}`)).size > 1) {
          throw new LedgerError('INVALID_CATEGORY', 'Reorder within one kind and group');
        }
        for (const [index, id] of ids.entries()) {
          await tx.update(categories).set({ sortOrder: index }).where(eq(categories.id, id));
        }
      }),
  };
}
