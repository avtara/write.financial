// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › Kategori (FR-K1/K2, design `YnLF6`, menu `iHweD`, delete `g8bxL`/`fDbls`): expense categories in
 * Kebutuhan, Keinginan, and the system group "Biaya keuangan"; income in Aktif, Pasif, Lainnya. Each row shows how
 * many transactions use it; drag the handle (or focus it and press ↑/↓) to change the order the Record Transaction
 * pickers use. The ⋯ menu edits, moves to another group, merges, archives, or deletes; system categories only edit.
 * Every change is saved at once.
 */
import { useNavigate, useRouter } from '@tanstack/react-router';
import type { CategoryView } from '@wf/db/categories';
import type { CategoryGroup } from '@wf/domain/categories';
import { m } from '@wf/i18n/messages';
import { ConfirmDialog } from '@wf/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@wf/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@wf/ui/tabs';
import { toast } from '@wf/ui/toast';
import {
  Archive,
  ArchiveRestore,
  ArrowLeftRight,
  Ellipsis,
  GripVertical,
  Lock,
  Merge,
  Pencil,
  Plus,
  ReceiptText,
  Trash2,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { categoryGroupLabel, categoryName } from '../../lib/ledger-labels.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import type { Result } from '../../server/access.ts';
import {
  archiveCategory,
  deleteCategory,
  moveCategory,
  reorderCategories,
  unarchiveCategory,
} from '../../server/fn/categories.ts';
import { CategoryIcon } from '../category-icon.tsx';
import { Button } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';
import { settle } from '../setup/result.ts';
import { CategoryDialog, type EditableKind } from './category-dialog.tsx';
import { CategoryMergeDialog } from './category-merge-dialog.tsx';

const TAB_GROUPS: Readonly<Record<EditableKind, readonly CategoryGroup[]>> = {
  expense: ['needs', 'wants', 'financial'],
  income: ['active', 'passive', 'other'],
};

const tabOf = (category: CategoryView): EditableKind => (category.kind === 'income' ? 'income' : 'expense');

const BADGE = 'inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium';

interface RowProps {
  readonly category: CategoryView;
  /** Position within its group, for the handle; `null` when it cannot be reordered (archived, alone). */
  readonly position: { readonly index: number; readonly total: number } | null;
  readonly dragging: boolean;
  readonly handleRef: (node: HTMLButtonElement | null) => void;
  readonly onMoveBy: (delta: -1 | 1) => void;
  readonly onDragStart: () => void;
  readonly onDragEnd: () => void;
  readonly onDropOn: () => void;
  readonly onEdit: () => void;
  readonly onMoveTo: (group: CategoryGroup) => void;
  readonly onMerge: () => void;
  readonly onArchive: () => void;
  readonly onUnarchive: () => void;
  readonly onDelete: () => void;
  readonly reorderHint: string;
}

function CategoryRow({
  category,
  position,
  dragging,
  handleRef,
  onMoveBy,
  onDragStart,
  onDragEnd,
  onDropOn,
  onEdit,
  onMoveTo,
  onMerge,
  onArchive,
  onUnarchive,
  onDelete,
  reorderHint,
}: RowProps) {
  const navigate = useNavigate();
  const name = categoryName(category);
  const archived = category.archivedAt !== null;
  const count =
    category.transactionCount === 0
      ? m.category_unused()
      : m.category_transaction_count({ count: category.transactionCount });
  const otherGroups = TAB_GROUPS[tabOf(category)].filter((group) => group !== category.group && group !== 'financial');
  return (
    <li
      draggable={position !== null}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', category.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onDragOver={(event) => {
        if (position !== null) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDropOn();
      }}
      className={`flex min-h-[52px] items-center gap-3 px-3 py-2 ${dragging ? 'opacity-50' : ''} ${archived ? 'text-muted-fg' : ''}`}
    >
      {position === null ? (
        <span aria-hidden="true" className="w-5 shrink-0" />
      ) : (
        <button
          ref={handleRef}
          type="button"
          aria-label={m.category_reorder({ name })}
          aria-describedby={reorderHint}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' && position.index > 0) {
              event.preventDefault();
              onMoveBy(-1);
            } else if (event.key === 'ArrowDown' && position.index < position.total - 1) {
              event.preventDefault();
              onMoveBy(1);
            }
          }}
          className="flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded-[5px] text-subtle hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          <GripVertical aria-hidden="true" className="size-3.5" />
        </button>
      )}
      <CategoryIcon icon={category.icon} color={category.color} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-medium text-fg">{name}</span>
        {/* Narrow rows show the count under the name instead of on the right. */}
        <span className="font-mono text-[11px] text-subtle @md:hidden">{count}</span>
      </div>
      {category.isSystem ? (
        <span className={`${BADGE} bg-surface-3 text-muted-fg`}>
          <Lock aria-hidden="true" className="size-2.5" />
          {m.category_badge_system()}
        </span>
      ) : null}
      {category.isFixed ? (
        <span className={`${BADGE} bg-blue-tint-2 text-blue-fg`}>{m.category_badge_fixed()}</span>
      ) : null}
      {archived ? <span className={`${BADGE} bg-surface-3 text-muted-fg`}>{m.category_badge_archived()}</span> : null}
      <span className="hidden shrink-0 text-right font-mono text-[11.5px] whitespace-nowrap text-subtle @md:inline">
        {count}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={m.category_menu({ name })}
          className="flex size-7 shrink-0 items-center justify-center rounded-[6px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-muted"
        >
          <Ellipsis aria-hidden="true" className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-[228px]">
          <DropdownMenuGroup>
            <DropdownMenuItem icon={Pencil} onSelect={onEdit}>
              {m.category_menu_edit()}
            </DropdownMenuItem>
            <DropdownMenuItem
              icon={ReceiptText}
              onSelect={() => {
                void navigate({ to: '/transactions', search: { category: category.id } });
              }}
            >
              {m.category_menu_view_transactions()}
            </DropdownMenuItem>
            {category.isSystem || archived
              ? null
              : otherGroups.map((group) => (
                  <DropdownMenuItem
                    key={group}
                    icon={ArrowLeftRight}
                    onSelect={() => {
                      onMoveTo(group);
                    }}
                  >
                    {m.category_menu_move({ group: categoryGroupLabel(group) })}
                  </DropdownMenuItem>
                ))}
          </DropdownMenuGroup>
          {category.isSystem ? null : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem icon={Merge} onSelect={onMerge}>
                  {m.category_menu_merge()}
                </DropdownMenuItem>
                {archived ? (
                  <DropdownMenuItem icon={ArchiveRestore} onSelect={onUnarchive}>
                    {m.category_menu_unarchive()}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem icon={Archive} onSelect={onArchive}>
                    {m.category_menu_archive()}
                  </DropdownMenuItem>
                )}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem icon={Trash2} variant="destructive" onSelect={onDelete}>
                  {m.category_menu_delete()}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

interface Editing {
  readonly category: CategoryView | null;
  readonly kind: EditableKind;
}

export function CategoriesSection({ categories }: { categories: readonly CategoryView[] }) {
  const router = useRouter();
  const { preferences } = usePreferences();
  const reorderHint = useId();
  const [tab, setTab] = useState<EditableKind>('expense');
  // The list as last loaded, with reorders applied at once while the server saves them.
  const [items, setItems] = useState(categories);
  const [loaded, setLoaded] = useState(categories);
  if (loaded !== categories) {
    setLoaded(categories);
    setItems(categories);
  }
  const [editing, setEditing] = useState<Editing | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [merging, setMerging] = useState<CategoryView | null>(null);
  const [deleting, setDeleting] = useState<CategoryView | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const handles = useRef(new Map<string, HTMLButtonElement>());
  // The handle moved with the keyboard keeps focus after its row moves.
  const refocus = useRef<string | null>(null);

  useEffect(() => {
    if (refocus.current === null) return;
    handles.current.get(refocus.current)?.focus();
    refocus.current = null;
  }, [items]);

  const refresh = () => {
    void router.invalidate();
  };

  const run = async <T,>(call: () => Promise<Result<T>>, done: (value: T) => void) => {
    const result = await settle(call);
    if (!result.ok) {
      toast({
        title: m.category_action_failed(),
        description: ledgerErrorMessage(result.code, preferences.locale),
        tone: 'error',
      });
      refresh();
      return;
    }
    done(result.value);
    refresh();
  };

  const live = (group: CategoryGroup) =>
    items
      .filter((category) => category.group === group && category.archivedAt === null)
      .sort((a, b) => a.sortOrder - b.sortOrder);

  const reorder = (moved: CategoryView, ids: readonly string[]) => {
    setItems((current) =>
      current.map((category) => {
        const index = ids.indexOf(category.id);
        return index === -1 ? category : { ...category, sortOrder: index };
      }),
    );
    setAnnouncement(
      m.category_reordered({ name: categoryName(moved), position: ids.indexOf(moved.id) + 1, total: ids.length }),
    );
    void run(
      () => reorderCategories({ data: { ids: [...ids] } }),
      () => undefined,
    );
  };

  const moveBy = (category: CategoryView, delta: -1 | 1) => {
    const ids = live(category.group).map((entry) => entry.id);
    const index = ids.indexOf(category.id);
    ids.splice(index, 1);
    ids.splice(index + delta, 0, category.id);
    refocus.current = category.id;
    reorder(category, ids);
  };

  const dropOn = (target: CategoryView) => {
    const dragged = items.find((category) => category.id === dragId);
    setDragId(null);
    if (dragged === undefined || dragged.id === target.id || dragged.group !== target.group) return;
    const ids = live(target.group)
      .map((entry) => entry.id)
      .filter((id) => id !== dragged.id);
    ids.splice(ids.indexOf(target.id) + (dragged.sortOrder < target.sortOrder ? 1 : 0), 0, dragged.id);
    reorder(dragged, ids);
  };

  const openEditor = (next: Editing) => {
    setEditing(next);
    setEditorOpen(true);
  };

  const rowFor = (category: CategoryView, position: RowProps['position']) => {
    const name = categoryName(category);
    return (
      <CategoryRow
        key={category.id}
        category={category}
        position={position}
        dragging={dragId === category.id}
        reorderHint={reorderHint}
        handleRef={(node) => {
          if (node === null) handles.current.delete(category.id);
          else handles.current.set(category.id, node);
        }}
        onMoveBy={(delta) => {
          moveBy(category, delta);
        }}
        onDragStart={() => {
          setDragId(category.id);
        }}
        onDragEnd={() => {
          setDragId(null);
        }}
        onDropOn={() => {
          dropOn(category);
        }}
        onEdit={() => {
          openEditor({ category, kind: tabOf(category) });
        }}
        onMoveTo={(group) => {
          void run(
            () => moveCategory({ data: { id: category.id, group } }),
            () => toast({ title: m.category_moved({ name, group: categoryGroupLabel(group) }) }),
          );
        }}
        onMerge={() => {
          setMerging(category);
        }}
        onArchive={() => {
          void run(
            () => archiveCategory({ data: { id: category.id } }),
            () =>
              toast({
                title: m.category_archived({ name }),
                action: {
                  label: m.category_undo(),
                  onClick: () => {
                    void run(
                      () => unarchiveCategory({ data: { id: category.id } }),
                      () => undefined,
                    );
                  },
                },
              }),
          );
        }}
        onUnarchive={() => {
          void run(
            () => unarchiveCategory({ data: { id: category.id } }),
            () => toast({ title: m.category_unarchived({ name }) }),
          );
        }}
        onDelete={() => {
          setDeleting(category);
        }}
      />
    );
  };

  const count = (kind: EditableKind) =>
    items.filter((category) => tabOf(category) === kind && category.archivedAt === null).length;

  return (
    <div className="flex flex-col gap-4">
      <p id={reorderHint} className="sr-only">
        {m.category_reorder_hint()}
      </p>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <Tabs
        value={tab}
        onValueChange={(next) => {
          setTab(next as EditableKind);
        }}
        className="flex flex-col gap-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList label={m.category_tabs_label()}>
            <TabsTrigger value="expense">{m.category_tab_expense({ count: count('expense') })}</TabsTrigger>
            <TabsTrigger value="income">{m.category_tab_income({ count: count('income') })}</TabsTrigger>
          </TabsList>
          <Button
            size="sm"
            onClick={() => {
              openEditor({ category: null, kind: tab });
            }}
          >
            <Plus aria-hidden="true" className="size-3.5" />
            {m.category_new()}
          </Button>
        </div>
        {(['expense', 'income'] as const).map((kind) => {
          const archived = items.filter((category) => tabOf(category) === kind && category.archivedAt !== null);
          return (
            <TabsContent key={kind} value={kind} className="flex flex-col gap-4">
              {TAB_GROUPS[kind].map((group) => {
                const rows = live(group);
                return (
                  <section key={group} aria-label={categoryGroupLabel(group)} className="flex flex-col gap-2">
                    <h3 className="text-[11px] font-medium text-subtle uppercase">
                      {categoryGroupLabel(group)} · {rows.length}
                    </h3>
                    {rows.length === 0 ? (
                      <p className="rounded-[10px] border border-dashed border-border px-3 py-3 text-[12.5px] text-subtle">
                        {m.category_group_empty()}
                      </p>
                    ) : (
                      <ul className="@container flex flex-col divide-y divide-border rounded-[10px] border border-border bg-surface-sunken">
                        {rows.map((category, index) =>
                          rowFor(category, rows.length > 1 ? { index, total: rows.length } : null),
                        )}
                      </ul>
                    )}
                  </section>
                );
              })}
              {archived.length === 0 ? null : (
                <section aria-label={m.category_archived_group()} className="flex flex-col gap-2">
                  <h3 className="text-[11px] font-medium text-subtle uppercase">
                    {m.category_archived_group()} · {archived.length}
                  </h3>
                  <ul className="@container flex flex-col divide-y divide-border rounded-[10px] border border-border bg-surface-sunken">
                    {archived.map((category) => rowFor(category, null))}
                  </ul>
                </section>
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      <CategoryDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        category={editing?.category ?? null}
        kind={editing?.kind ?? tab}
        onSaved={(category, created) => {
          setEditorOpen(false);
          toast({
            title: created
              ? m.category_created({ name: categoryName(category) })
              : m.category_saved({ name: categoryName(category) }),
          });
          setTab(tabOf(category));
          refresh();
        }}
      />
      <CategoryMergeDialog
        source={merging}
        categories={items}
        onClose={() => {
          setMerging(null);
        }}
        onMerged={(source, target, moved) => {
          setMerging(null);
          toast({
            title: m.category_merged({ source: categoryName(source), target: categoryName(target) }),
            description: m.category_merged_count({ count: moved }),
          });
          refresh();
        }}
      />
      {deleting === null ? null : (
        <ConfirmDialog
          open
          onOpenChange={() => {
            setDeleting(null);
          }}
          variant="destructive"
          title={m.category_delete_title({ name: categoryName(deleting) })}
          description={
            deleting.transactionCount === 0
              ? m.category_delete_unused()
              : m.category_delete_used({ count: deleting.transactionCount })
          }
          {...(deleting.transactionCount === 0
            ? {}
            : { impact: m.category_delete_impact({ count: deleting.transactionCount }) })}
          cancelLabel={m.settings_cancel()}
          confirmLabel={m.category_menu_delete()}
          onConfirm={() => {
            const name = categoryName(deleting);
            void run(
              () => deleteCategory({ data: { id: deleting.id } }),
              ({ uncategorized }) =>
                toast({
                  title: m.category_deleted({ name }),
                  ...(uncategorized === 0
                    ? {}
                    : {
                        description: m.category_deleted_uncategorized({ count: uncategorized }),
                        tone: 'warning' as const,
                      }),
                }),
            );
          }}
        />
      )}
    </div>
  );
}
