// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tags (FR-K3): list with usage counts (`#` autocomplete), create, rename, merge (the source slug becomes an alias
 * of the target, so old input keeps resolving), delete, and likely duplicates to suggest merging.
 */
import { normalizeTagSlug } from '@wf/domain/tags';
import { and, asc, desc, eq, like, ne, or, sql, type SQL } from 'drizzle-orm';
import { withUser, type Database, type Transaction } from './db.ts';
import { logActivity } from './activity.ts';
import { resolveTagsIn } from './ledger-core.ts';
import { LedgerError } from './ledger-errors.ts';
import { goals, tagAliases, tags, transactionTags } from './schema.ts';

export interface TagView {
  readonly id: string;
  readonly slug: string;
  /** Non-deleted transactions carrying the tag. */
  readonly usageCount: number;
  /** Slugs of tags merged into this one, sorted. */
  readonly aliases: string[];
}

export interface TagPair {
  readonly a: string;
  readonly b: string;
}

export interface TagsRepository {
  /**
   * The user's tags, most used first (then by slug). `query` (normalized like a tag) keeps tags whose slug or an
   * alias contains it; a query without letters or digits (e.g. a bare `#`) lists everything.
   */
  list: (userId: string, options?: { query?: string }) => Promise<TagView[]>;
  /**
   * The tag for `input` (`#Dana Darurat` → `dana-darurat`), created when missing; an alias resolves to its tag.
   * @throws {LedgerError} `INVALID_TAG`
   */
  create: (userId: string, input: string) => Promise<TagView>;
  /**
   * Changes the slug. Renaming to a slug another tag (or another tag's alias) uses is refused rather than merged.
   * @throws {LedgerError} `NOT_FOUND`, `INVALID_TAG`
   */
  rename: (userId: string, id: string, input: string) => Promise<TagView>;
  /**
   * Moves the source's transactions, goals, and aliases to the target, makes the source slug an alias of the
   * target, and deletes the source. Returns the target.
   * @throws {LedgerError} `NOT_FOUND`, `INVALID_TAG` (source = target)
   */
  merge: (userId: string, sourceId: string, targetId: string) => Promise<TagView>;
  /** Deletes the tag (and its aliases) from every transaction; goals tracking it lose their tag. */
  remove: (userId: string, id: string) => Promise<void>;
  /** Slug pairs (`a` < `b`) that are probably the same tag: a plural, a prefix, or a typo. */
  similar: (userId: string) => Promise<TagPair[]>;
}

/** Minimum length of the shorter slug for a prefix match (`kopi` / `kopi-susu`); shorter prefixes are noise. */
const MIN_PREFIX = 3;
/** Typo matches (edit distance ≤ {@link MAX_DISTANCE}) only for slugs at least this long. */
const MIN_TYPO_LENGTH = 5;
const MAX_DISTANCE = 2;

/** Levenshtein edit distance (insertions, deletions, substitutions). */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitution = (previous[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min((previous[j] as number) + 1, (current[j - 1] as number) + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length] as number;
}

/** Whether two different slugs (`a` < `b`) look like the same tag. */
function likelySameTag(a: string, b: string): boolean {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long === `${short}s` || long === `${short}es`) return true;
  if (short.length >= MIN_PREFIX && long.startsWith(short)) return true;
  return short.length >= MIN_TYPO_LENGTH && editDistance(a, b) <= MAX_DISTANCE;
}

// Correlated subqueries are written out: Drizzle leaves columns unqualified in single-table selects, so `tags.id`
// would resolve to the inner table's `id`.
async function viewsIn(tx: Transaction, where?: SQL): Promise<TagView[]> {
  const usageCount = sql<number>`(select count(*)::int from transaction_tags tt join transactions t on t.id = tt.transaction_id where tt.tag_id = tags.id and t.deleted_at is null)`;
  const aliases = sql<
    string[]
  >`coalesce((select array_agg(a.slug::text order by a.slug) from tag_aliases a where a.tag_id = tags.id), '{}')`;
  return tx
    .select({ id: tags.id, slug: tags.slug, usageCount, aliases })
    .from(tags)
    .where(where)
    .orderBy(desc(usageCount), asc(tags.slug));
}

async function viewIn(tx: Transaction, id: string): Promise<TagView> {
  const [view] = await viewsIn(tx, eq(tags.id, id));
  if (view === undefined) throw new LedgerError('NOT_FOUND', 'No such tag');
  return view;
}

export function createTags(db: Database): TagsRepository {
  return {
    list: (userId, { query } = {}) =>
      withUser(db, userId, (tx) => {
        const slug = query === undefined ? null : normalizeTagSlug(query);
        if (slug === null) return viewsIn(tx);
        const pattern = `%${slug}%`;
        return viewsIn(
          tx,
          or(
            like(tags.slug, pattern),
            sql`exists (select 1 from tag_aliases a where a.tag_id = tags.id and a.slug like ${pattern})`,
          ),
        );
      }),

    create: (userId, input) =>
      withUser(db, userId, async (tx) => {
        const [id] = await resolveTagsIn(tx, userId, [input]);
        return viewIn(tx, id as string);
      }),

    rename: (userId, id, input) =>
      withUser(db, userId, async (tx) => {
        const slug = normalizeTagSlug(input);
        if (slug === null) throw new LedgerError('INVALID_TAG', 'A tag must contain a letter or digit');
        const current = await viewIn(tx, id);
        if (current.slug === slug) return current;
        const [taken] = await tx
          .select({ id: tags.id })
          .from(tags)
          .where(and(eq(tags.slug, slug), ne(tags.id, id)))
          .unionAll(
            tx
              .select({ id: tagAliases.tagId })
              .from(tagAliases)
              .where(and(eq(tagAliases.slug, slug), ne(tagAliases.tagId, id))),
          );
        if (taken !== undefined) throw new LedgerError('INVALID_TAG', 'Another tag uses this slug');
        // Renaming back to one of the tag's own former slugs: that alias is no longer needed.
        await tx.delete(tagAliases).where(eq(tagAliases.slug, slug));
        await tx.update(tags).set({ slug }).where(eq(tags.id, id));
        await logActivity(tx, userId, 'tag', [id], 'updated', { fields: ['slug'] });
        return viewIn(tx, id);
      }),

    merge: (userId, sourceId, targetId) =>
      withUser(db, userId, async (tx) => {
        if (sourceId === targetId) throw new LedgerError('INVALID_TAG', 'A tag cannot be merged into itself');
        const source = await viewIn(tx, sourceId);
        await viewIn(tx, targetId);
        // UPDATE, not INSERT: the five-tags trigger fires on inserts, and the source leaves the transaction anyway.
        await tx
          .update(transactionTags)
          .set({ tagId: targetId })
          .where(
            and(
              eq(transactionTags.tagId, sourceId),
              sql`not exists (select 1 from transaction_tags other where other.transaction_id = transaction_tags.transaction_id and other.tag_id = ${targetId})`,
            ),
          );
        await tx.update(goals).set({ tagId: targetId }).where(eq(goals.tagId, sourceId));
        await tx.update(tagAliases).set({ tagId: targetId }).where(eq(tagAliases.tagId, sourceId));
        await tx.insert(tagAliases).values({ userId, tagId: targetId, slug: source.slug });
        await tx.delete(tags).where(eq(tags.id, sourceId));
        await logActivity(tx, userId, 'tag', [targetId], 'merged', { from: sourceId });
        return viewIn(tx, targetId);
      }),

    remove: (userId, id) =>
      withUser(db, userId, async (tx) => {
        await tx.update(goals).set({ tagId: null }).where(eq(goals.tagId, id));
        const rows = await tx.delete(tags).where(eq(tags.id, id)).returning({ id: tags.id });
        if (rows.length === 0) throw new LedgerError('NOT_FOUND', 'No such tag');
        await logActivity(tx, userId, 'tag', [id], 'deleted');
      }),

    similar: (userId) =>
      withUser(db, userId, async (tx) => {
        const slugs = (await tx.select({ slug: tags.slug }).from(tags).orderBy(asc(tags.slug))).map((row) => row.slug);
        const pairs: TagPair[] = [];
        for (const [i, a] of slugs.entries()) {
          for (const b of slugs.slice(i + 1)) if (likelySameTag(a, b)) pairs.push({ a, b });
        }
        return pairs;
      }),
  };
}
