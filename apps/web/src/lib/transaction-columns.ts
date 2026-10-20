// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Atur kolom" (FR-L2, design `q1t7n8`): the table's columns in the user's order, which are shown, and the row
 * density. Saved in `user_preferences.table_prefs.transactions`; whatever is stored there is read leniently
 * ({@link tablePrefsOf}), so a column added later appears in its default place and unknown ids are dropped.
 */
import * as z from 'zod';

export const TRANSACTION_COLUMNS = [
  'time',
  'description',
  'tags',
  'category',
  'account',
  'amount',
  'attachment',
  'balance',
  'source',
] as const;
export type TransactionColumn = (typeof TRANSACTION_COLUMNS)[number];

/** Always shown ("Deskripsi", "Jumlah" with the lock icon). */
export const LOCKED_COLUMNS: readonly TransactionColumn[] = ['description', 'amount'];

/** Hidden until switched on. */
const HIDDEN_BY_DEFAULT: readonly TransactionColumn[] = ['attachment', 'balance', 'source'];

export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

export const TABLE_PREFS = z.object({
  columns: z
    .array(z.object({ id: z.enum(TRANSACTION_COLUMNS), visible: z.boolean() }))
    .max(TRANSACTION_COLUMNS.length)
    .refine((columns) => new Set(columns.map((column) => column.id)).size === columns.length, 'Duplicate column'),
  density: z.enum(DENSITIES),
});
export type TablePrefs = z.infer<typeof TABLE_PREFS>;

export const DEFAULT_TABLE_PREFS: TablePrefs = {
  columns: TRANSACTION_COLUMNS.map((id) => ({ id, visible: !HIDDEN_BY_DEFAULT.includes(id) })),
  density: 'comfortable',
};

/** What may be stored: column ids of older or newer versions are tolerated here and dropped by {@link tablePrefsOf}. */
const STORED_PREFS = z.object({
  columns: z.array(z.object({ id: z.string(), visible: z.boolean() })),
  density: z.enum(DENSITIES).catch(DEFAULT_TABLE_PREFS.density),
});

/**
 * The prefs stored under `table_prefs.transactions`, completed: unknown and repeated columns are dropped, missing
 * ones are inserted after their default predecessor with their default visibility, locked columns are always
 * visible, and anything unreadable gives the defaults.
 */
export function tablePrefsOf(stored: unknown): TablePrefs {
  const parsed = STORED_PREFS.safeParse(stored);
  if (!parsed.success) return DEFAULT_TABLE_PREFS;
  const columns: TablePrefs['columns'] = [];
  for (const column of parsed.data.columns) {
    const id = TRANSACTION_COLUMNS.find((known) => known === column.id);
    if (id === undefined || columns.some((kept) => kept.id === id)) continue;
    columns.push({ id, visible: column.visible || LOCKED_COLUMNS.includes(id) });
  }
  for (const [index, fallback] of DEFAULT_TABLE_PREFS.columns.entries()) {
    if (columns.some((column) => column.id === fallback.id)) continue;
    const before = DEFAULT_TABLE_PREFS.columns[index - 1]?.id;
    const at = before === undefined ? 0 : columns.findIndex((column) => column.id === before) + 1;
    columns.splice(at, 0, fallback);
  }
  return { columns, density: parsed.data.density };
}
