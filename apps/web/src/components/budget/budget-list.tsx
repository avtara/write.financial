// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Anggaran per kategori" (FR-B2, design `E86u2e`, tabs `p4FGEL`, sort `KHy8x`, menu `WdceE`, inline edit `U4jwnw`,
 * add `I7KGD`): Semua / Kebutuhan / Keinginan tabs, "Urutkan", one row per budget line with its bar and the ideal
 * marker, the limit edited in place (↵ saves, Esc cancels), the ⋮ menu with the FR-B4 options, and "Tambah kategori
 * anggaran". A closed period (FR-P3) shows the rows without any edit control.
 */
import type { BudgetLineView } from '@wf/db/budgets';
import type { CategoryView } from '@wf/db/categories';
import type { CategoryGroup as SpendingGroup } from '@wf/db/transaction-query';
import { ALERT_PCTS, type AlertPct } from '@wf/domain/budget';
import type { CategoryGroup } from '@wf/domain/categories';
import { m } from '@wf/i18n/messages';
import { AmountInput } from '@wf/ui/amount-input';
import { Combobox, type ComboboxGroup } from '@wf/ui/command';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@wf/ui/dropdown-menu';
import { KbdHint } from '@wf/ui/kbd-hint';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@wf/ui/tabs';
import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowLeftRight,
  BellOff,
  CircleMinus,
  Ellipsis,
  FolderPlus,
  GripVertical,
  LineChart,
  Pencil,
  Plus,
  Shapes,
  TriangleAlert,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { categoryGroupLabel, categoryName } from '../../lib/ledger-labels.ts';
import { CATEGORY_ICONS, CategoryIcon } from '../category-icon.tsx';
import { RichMessage } from '../rich-message.tsx';
import { BudgetBar } from './budget-bar.tsx';
import { Amount, Pct, useBudgetFormat } from './budget-format.tsx';
import { BUDGET_SORTS, lineTone, sortLines, type BudgetSort, type BudgetTab } from './budget-model.ts';

const ROW_BUTTON =
  'flex size-7 shrink-0 items-center justify-center rounded-[6px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-muted';

const SORT_ICONS: Readonly<Record<BudgetSort, LucideIcon>> = {
  used: ArrowDownWideNarrow,
  over_first: TriangleAlert,
  remaining: Wallet,
  name: ArrowDownAZ,
  custom: GripVertical,
};

const SORT_LABELS: Readonly<Record<BudgetSort, () => string>> = {
  used: m.budget_sort_used,
  over_first: m.budget_sort_over_first,
  remaining: m.budget_sort_remaining,
  name: m.budget_sort_name,
  custom: m.budget_sort_custom,
};

const BADGE_TONE = {
  over: 'bg-red-tint-2 text-red-fg',
  warning: 'bg-amber-tint-2 text-amber-fg',
  ok: 'bg-surface-3 text-muted-fg',
  idle: 'bg-surface-3 text-muted-fg',
} as const;

/** The expense groups the list shows, in order. */
const LIST_GROUPS = ['needs', 'wants', 'financial'] as const;
type ListGroup = (typeof LIST_GROUPS)[number];

const GROUP_DOT: Readonly<Record<ListGroup, string>> = { needs: 'bg-blue', wants: 'bg-violet', financial: 'bg-cyan' };

/** What a row asks the page to do. */
export interface BudgetLineActions {
  readonly onEditLimit: (line: BudgetLineView) => void;
  /** ↵ in the inline editor; resolves `true` once saved (the editor then closes). */
  readonly onSaveLimit: (line: BudgetLineView, limitMinor: bigint) => Promise<boolean>;
  readonly onCancelEdit: () => void;
  readonly onMoveFrom: (line: BudgetLineView) => void;
  readonly onDetail: (line: BudgetLineView) => void;
  readonly onOptions: (
    line: BudgetLineView,
    patch: { readonly rollover?: boolean; readonly isFixed?: boolean; readonly alertPct?: AlertPct },
  ) => void;
  readonly onRemove: (line: BudgetLineView) => void;
}

/** The second line of a row: "sisa Rp300.000 · Rp19.000/hari", "lewat Rp400.000", "lunas", "belum terpakai". */
export function LineNote({ line, readOnly }: { line: BudgetLineView; readOnly: boolean }) {
  if (line.state === 'over') {
    return (
      <span className="text-red-fg">
        <RichMessage message={m.budget_line_over} slots={{ amount: <Amount valueMinor={-line.remainingMinor} /> }} />
      </span>
    );
  }
  if (line.state === 'paid') return <span>{m.budget_line_paid()}</span>;
  if (line.state === 'unused') return <span>{m.budget_line_unused()}</span>;
  if (!readOnly && line.willExceedByMinor > 0n) {
    return (
      <span className="text-amber-fg">
        <RichMessage
          message={m.budget_line_will_exceed}
          slots={{ amount: <Amount valueMinor={line.willExceedByMinor} /> }}
        />
      </span>
    );
  }
  if (readOnly || line.safeDailyMinor === null) {
    return <RichMessage message={m.budget_line_left} slots={{ amount: <Amount valueMinor={line.remainingMinor} /> }} />;
  }
  return (
    <RichMessage
      message={m.budget_line_left_daily}
      slots={{
        amount: <Amount valueMinor={line.remainingMinor} />,
        daily: <Amount valueMinor={line.safeDailyMinor} />,
      }}
    />
  );
}

interface RowProps {
  readonly line: BudgetLineView;
  readonly readOnly: boolean;
  readonly idealBps: number;
  readonly editing: boolean;
  readonly totalLimitMinor: bigint;
  readonly actions: BudgetLineActions;
}

function LimitEditor({ line, totalLimitMinor, actions }: Omit<RowProps, 'readOnly' | 'idealBps' | 'editing'>) {
  const { currency, locale } = useBudgetFormat();
  const name = categoryName(line);
  const [value, setValue] = useState<bigint | null>(line.baseLimitMinor);
  const [saving, setSaving] = useState(false);
  const deltaMinor = (value ?? line.baseLimitMinor) - line.baseLimitMinor;
  const hintId = `budget-limit-hint-${line.categoryId}`;
  return (
    <div className="relative">
      <div className="w-[112px]">
        <AmountInput
          value={value}
          onValueChange={setValue}
          currency={currency}
          locale={locale}
          size="inline"
          aria-label={m.budget_limit_edit_label({ name })}
          aria-describedby={hintId}
          autoFocus
          disabled={saving}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              actions.onCancelEdit();
            } else if (event.key === 'Enter' && value !== null) {
              event.preventDefault();
              setSaving(true);
              void actions.onSaveLimit(line, value).then((saved) => {
                if (!saved) setSaving(false);
              });
            }
          }}
        />
      </div>
      <p
        id={hintId}
        className="absolute top-full right-0 z-10 mt-1.5 flex items-center gap-x-2 rounded-[7px] border border-border bg-popover px-2 py-1 font-mono text-[11px] whitespace-nowrap text-muted-fg shadow-[0_8px_24px_var(--shadow)]"
      >
        {deltaMinor === 0n ? null : (
          <span className={deltaMinor < 0n ? 'text-green-fg' : 'text-amber-fg'}>
            <RichMessage
              message={deltaMinor < 0n ? m.budget_limit_delta_down : m.budget_limit_delta_up}
              slots={{
                delta: <Amount valueMinor={deltaMinor < 0n ? -deltaMinor : deltaMinor} />,
                total: <Amount valueMinor={totalLimitMinor + deltaMinor} />,
              }}
            />
          </span>
        )}
        <span className="flex items-center gap-1">
          <KbdHint keys={['↵']} platform="other" /> {m.budget_limit_save_hint()}
        </span>
        <span className="flex items-center gap-1">
          <KbdHint keys={['Esc']} platform="other" /> {m.budget_limit_cancel_hint()}
        </span>
      </p>
    </div>
  );
}

function LineMenu({ line, actions }: { line: BudgetLineView; actions: BudgetLineActions }) {
  const name = categoryName(line);
  const movable = !line.isFixed && line.remainingMinor > 0n;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={m.budget_line_menu({ name })} className={ROW_BUTTON}>
        <Ellipsis aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[264px]">
        <DropdownMenuGroup>
          <DropdownMenuItem
            icon={Pencil}
            onSelect={() => {
              actions.onEditLimit(line);
            }}
          >
            {m.budget_menu_edit_limit()}
            <Amount valueMinor={line.baseLimitMinor} bare className="ml-auto pl-3 text-[11.5px] text-subtle" />
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={ArrowLeftRight}
            disabled={!movable}
            onSelect={() => {
              actions.onMoveFrom(line);
            }}
          >
            {m.budget_menu_move_from()}
            {movable ? (
              <Amount valueMinor={line.remainingMinor} className="ml-auto pl-3 text-[11.5px] text-subtle" />
            ) : null}
          </DropdownMenuItem>
          <DropdownMenuItem
            icon={LineChart}
            onSelect={() => {
              actions.onDetail(line);
            }}
          >
            {m.budget_menu_detail()}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuCheckboxItem
            indicator="switch"
            checked={line.rollover}
            onCheckedChange={(rollover) => {
              actions.onOptions(line, { rollover });
            }}
          >
            {m.budget_menu_rollover()}
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            indicator="switch"
            checked={line.isFixed}
            onCheckedChange={(isFixed) => {
              actions.onOptions(line, { isFixed });
            }}
          >
            {m.budget_menu_fixed()}
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>{m.budget_menu_alert_label()}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={String(line.alertPct)}
            onValueChange={(value) => {
              actions.onOptions(line, { alertPct: Number(value) as AlertPct });
            }}
          >
            {ALERT_PCTS.map((pct) => (
              <DropdownMenuRadioItem key={pct} value={String(pct)}>
                {m.budget_menu_alert({ pct })}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            icon={CircleMinus}
            variant="destructive"
            onSelect={() => {
              actions.onRemove(line);
            }}
          >
            {m.budget_menu_remove()}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BudgetRow({ line, readOnly, idealBps, editing, totalLimitMinor, actions }: RowProps) {
  const name = categoryName(line);
  const tone = lineTone(line);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-3 @2xl:grid-cols-[minmax(0,1fr)_minmax(96px,160px)_auto]">
      <div className="flex min-w-0 items-center gap-3">
        <CategoryIcon icon={line.icon} color={line.color} />
        <div className="flex min-w-0 flex-col">
          <span className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                actions.onDetail(line);
              }}
              className="truncate text-left text-[13.5px] font-medium text-fg hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {name}
            </button>
            {line.dismissed ? (
              <BellOff aria-label={m.budget_line_dismissed()} role="img" className="size-3 shrink-0 text-subtle" />
            ) : null}
          </span>
          <span className="truncate text-[12px] text-subtle">
            <LineNote line={line} readOnly={readOnly} />
          </span>
        </div>
      </div>
      <div className="col-span-2 row-start-2 @2xl:col-span-1 @2xl:col-start-2 @2xl:row-start-1">
        <BudgetBar usedBps={line.usedBps} tone={tone} idealBps={readOnly || line.isFixed ? null : idealBps} />
      </div>
      <div className="flex items-center justify-end gap-3">
        <span className="flex items-center justify-end font-mono text-[13px] whitespace-nowrap @2xl:min-w-[14rem]">
          <Amount valueMinor={line.spentMinor} className={tone === 'over' ? 'text-red-fg' : 'text-fg'} />
          <span className="text-subtle">&nbsp;/&nbsp;</span>
          {readOnly ? (
            <Amount valueMinor={line.limitMinor} bare className="text-subtle" />
          ) : editing ? (
            <LimitEditor line={line} totalLimitMinor={totalLimitMinor} actions={actions} />
          ) : (
            <button
              type="button"
              onClick={() => {
                actions.onEditLimit(line);
              }}
              className="rounded-[5px] px-0.5 text-subtle hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
            >
              {/* "Ubah batas Makan 3.500.000": the action, then the amount it shows (WCAG 2.5.3). */}
              <span className="sr-only">{m.budget_limit_edit_label({ name })} </span>
              <Amount valueMinor={line.limitMinor} bare />
            </button>
          )}
        </span>
        <span
          className={`inline-flex h-5 min-w-[42px] items-center justify-center rounded-[5px] px-1.5 font-mono text-[11px] font-medium ${BADGE_TONE[tone]}`}
        >
          <Pct bps={line.usedBps} />
        </span>
        {readOnly ? null : <LineMenu line={line} actions={actions} />}
      </div>
    </li>
  );
}

/** "Tambah kategori anggaran": expense categories without a line, with this period's spending. */
function AddCategory({
  lines,
  categories,
  spending,
  onAdd,
  onCreate,
}: {
  lines: readonly BudgetLineView[];
  categories: readonly CategoryView[];
  spending: readonly SpendingGroup[];
  onAdd: (categoryId: string) => void;
  onCreate: () => void;
}) {
  const budgeted = new Set(lines.map((line) => line.categoryId));
  const spentOf = new Map(spending.map((row) => [row.categoryId, row.totalMinor]));
  const candidates = categories.filter(
    (category) => category.kind !== 'income' && category.archivedAt === null && !budgeted.has(category.id),
  );
  const groups: ComboboxGroup[] = LIST_GROUPS.map((group) => ({
    heading: categoryGroupLabel(group),
    options: candidates
      .filter((category) => category.group === group)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((category) => ({
        value: category.id,
        label: categoryName(category),
        icon: CATEGORY_ICONS[category.icon]?.glyph ?? Shapes,
        aside: (
          <span className="font-mono text-[11px] text-subtle">
            <RichMessage
              message={m.budget_add_spent}
              slots={{ amount: <Amount valueMinor={spentOf.get(category.id) ?? 0n} /> }}
            />
          </span>
        ),
      })),
  })).filter((group) => group.options.length > 0);
  return (
    <Combobox
      value={null}
      onValueChange={onAdd}
      groups={groups}
      label={m.budget_add_label()}
      searchPlaceholder={m.budget_add_search()}
      emptyLabel={m.budget_add_empty()}
      contentClassName="w-[360px]"
      footer={(close) => (
        <button
          type="button"
          onClick={() => {
            close();
            onCreate();
          }}
          className="flex h-9 w-full items-center gap-2 rounded-[6px] px-2 text-[13px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
        >
          <FolderPlus aria-hidden="true" className="size-4 text-muted-fg" />
          {m.budget_add_create()}
        </button>
      )}
    >
      <button
        type="button"
        className="flex h-11 w-full items-center gap-2 px-5 text-[13px] font-medium text-fg hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      >
        <Plus aria-hidden="true" className="size-4" />
        {m.budget_add_button()}
      </button>
    </Combobox>
  );
}

export interface BudgetListProps {
  readonly lines: readonly BudgetLineView[];
  readonly readOnly: boolean;
  readonly idealBps: number;
  readonly totalLimitMinor: bigint;
  readonly editingId: string | null;
  readonly actions: BudgetLineActions;
  readonly categories: readonly CategoryView[];
  readonly spending: readonly SpendingGroup[];
  readonly onAdd: (categoryId: string) => void;
  readonly onCreateCategory: () => void;
}

export function BudgetList({
  lines,
  readOnly,
  idealBps,
  totalLimitMinor,
  editingId,
  actions,
  categories,
  spending,
  onAdd,
  onCreateCategory,
}: BudgetListProps) {
  const { locale } = useBudgetFormat();
  const [tab, setTab] = useState<BudgetTab>('all');
  const [sort, setSort] = useState<BudgetSort>('custom');
  const [grouped, setGrouped] = useState(true);
  const groups = LIST_GROUPS.filter((group) => lines.some((line) => line.group === group));
  const overCount = lines.filter((line) => line.state === 'over').length;
  const SortIcon = SORT_ICONS[sort];
  const membersOf = (group: CategoryGroup) => {
    const members = lines.filter((line) => line.group === group);
    return {
      members,
      spent: members.reduce((total, line) => total + line.spentMinor, 0n),
      limit: members.reduce((total, line) => total + line.limitMinor, 0n),
    };
  };

  const rows = (subset: readonly BudgetLineView[]) => (
    <ul className="flex flex-col divide-y divide-border">
      {sortLines(subset, sort, categoryName, locale).map((line) => (
        <BudgetRow
          key={line.categoryId}
          line={line}
          readOnly={readOnly}
          idealBps={idealBps}
          editing={editingId === line.categoryId}
          totalLimitMinor={totalLimitMinor}
          actions={actions}
        />
      ))}
    </ul>
  );

  const section = (group: ListGroup) => {
    const { members, spent, limit } = membersOf(group);
    return (
      <section key={group} aria-label={categoryGroupLabel(group)} className="flex flex-col">
        <h3 className="flex items-center justify-between gap-3 border-b border-border px-5 pt-3 pb-2 text-[13px] font-medium text-fg">
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className={`size-1.5 rounded-full ${GROUP_DOT[group]}`} />
            {categoryGroupLabel(group)}
          </span>
          <span className="font-mono text-[12px] font-normal text-muted-fg">
            <Amount valueMinor={spent} /> / <Amount valueMinor={limit} />
          </span>
        </h3>
        {rows(members)}
      </section>
    );
  };

  return (
    <section aria-labelledby="budget-list-title" className="@container rounded-[14px] border border-border bg-card">
      <Tabs
        value={tab}
        onValueChange={(next) => {
          setTab(next as BudgetTab);
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4">
          <div className="flex flex-col gap-0.5">
            <h2 id="budget-list-title" className="text-[15px] font-semibold text-fg">
              {m.budget_list_title()}
            </h2>
            <p className="text-[12.5px] text-muted-fg">
              {readOnly
                ? m.budget_list_description_closed({ count: lines.length, over: overCount })
                : m.budget_list_description({ count: lines.length })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TabsList label={m.budget_tabs_label()}>
              <TabsTrigger value="all">{m.budget_tab_all()}</TabsTrigger>
              {groups.map((group) => (
                <TabsTrigger key={group} value={group}>
                  {categoryGroupLabel(group)}
                </TabsTrigger>
              ))}
            </TabsList>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={m.budget_sort_menu({ sort: SORT_LABELS[sort]() })}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-border px-2.5 text-[12.5px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:bg-muted"
              >
                <SortIcon aria-hidden="true" className="size-3.5 text-muted-fg" />
                {SORT_LABELS[sort]()}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[260px]">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{m.budget_sort_label()}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={sort}
                    onValueChange={(next) => {
                      setSort(next as BudgetSort);
                    }}
                  >
                    {BUDGET_SORTS.map((option) => (
                      <DropdownMenuRadioItem key={option} value={option}>
                        {SORT_LABELS[option]()}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuCheckboxItem indicator="switch" checked={grouped} onCheckedChange={setGrouped}>
                    {m.budget_sort_grouped()}
                  </DropdownMenuCheckboxItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <TabsContent value="all" className="border-t border-border">
          {grouped ? groups.map(section) : rows(lines)}
        </TabsContent>
        {groups.map((group) => {
          const { members, spent, limit } = membersOf(group);
          return (
            <TabsContent key={group} value={group} className="border-t border-border">
              <p className="px-5 pt-3 text-[12px] text-muted-fg">
                <RichMessage
                  message={m.budget_tab_summary}
                  slots={{
                    count: String(members.length),
                    group: categoryGroupLabel(group),
                    spent: <Amount valueMinor={spent} />,
                    limit: <Amount valueMinor={limit} />,
                    used: <Pct bps={limit > 0n ? Number((spent * 10_000n) / limit) : null} />,
                  }}
                />
              </p>
              {rows(members)}
            </TabsContent>
          );
        })}
      </Tabs>
      {readOnly ? null : (
        <div className="border-t border-border">
          <AddCategory
            lines={lines}
            categories={categories}
            spending={spending}
            onAdd={onAdd}
            onCreate={onCreateCategory}
          />
        </div>
      )}
    </section>
  );
}
