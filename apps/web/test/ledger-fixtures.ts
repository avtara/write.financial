// SPDX-License-Identifier: AGPL-3.0-only
/** Ledger views for component tests (shapes from `@wf/db`). */
import type { CategoryView } from '@wf/db/categories';
import type { TagView } from '@wf/db/tags';

export function categoryView(patch: Partial<CategoryView> = {}): CategoryView {
  return {
    id: 'c-1',
    kind: 'expense',
    group: 'wants',
    name: 'Belanja Online',
    builtInKey: null,
    icon: 'shopping-bag',
    color: 'violet',
    sortOrder: 0,
    isFixed: false,
    isSystem: false,
    archivedAt: null,
    transactionCount: 12,
    ...patch,
  };
}

export function tagView(slug: string, usageCount = 0, aliases: string[] = []): TagView {
  return { id: `t-${slug}`, slug, usageCount, aliases };
}
