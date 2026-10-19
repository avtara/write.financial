// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Category pickers of the ledger forms (FR-T2): tiles of the most used categories plus "Lainnya", and a searchable
 * popover over every category of the kind, grouped (Kebutuhan / Keinginan, Aktif / Pasif, …). Budget status per
 * category ("sisa anggaran Rp300.000") arrives with budgets in M2 through {@link CategoryPickerProps.budgetNote}.
 */
import type { CategoryView } from '@wf/db/categories';
import { GROUPS_BY_KIND, type CategoryKind } from '@wf/domain/categories';
import { m } from '@wf/i18n/messages';
import { Combobox, type ComboboxGroup } from '@wf/ui/command';
import { ChevronsUpDown, CirclePlus, Shapes } from 'lucide-react';
import { useRef, type ComponentProps, type ReactElement, type ReactNode } from 'react';
import { categoryGroupLabel, categoryName } from '../../lib/ledger-labels.ts';
import { CATEGORY_ICONS, CategoryIcon } from '../category-icon.tsx';

/** Tiles before "Lainnya" (a 3 × 2 grid). */
const TILE_COUNT = 5;

/** The live categories of `kind`, most used first (ties keep the user's order). */
export function frequentCategories(categories: readonly CategoryView[], kind: CategoryKind): CategoryView[] {
  return categories
    .filter((category) => category.kind === kind && category.archivedAt === null)
    .sort((a, b) => b.transactionCount - a.transactionCount || a.sortOrder - b.sortOrder);
}

interface PickerCommon {
  readonly categories: readonly CategoryView[];
  readonly kind: CategoryKind;
  readonly value: string | null;
  readonly onValueChange: (id: string) => void;
  /** Names the search field and list, e.g. "Pilih kategori". */
  readonly label: string;
  readonly searchPlaceholder: string;
  /** M2 seam: the budget note shown beside a category ("sisa anggaran Rp300.000"); none in M1. */
  readonly budgetNote?: (category: CategoryView) => ReactNode;
}

function groupsOf({ categories, kind, budgetNote }: PickerCommon): ComboboxGroup[] {
  const live = categories.filter((category) => category.kind === kind && category.archivedAt === null);
  return GROUPS_BY_KIND[kind]
    .map((group) => ({
      heading: categoryGroupLabel(group),
      options: live
        .filter((category) => category.group === group)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((category) => ({
          value: category.id,
          label: categoryName(category),
          icon: CATEGORY_ICONS[category.icon] ?? Shapes,
          aside: budgetNote?.(category),
        })),
    }))
    .filter((group) => group.options.length > 0);
}

function CategorySearch({ children, ...common }: PickerCommon & { readonly children: ReactElement }) {
  return (
    <Combobox
      value={common.value}
      onValueChange={common.onValueChange}
      groups={groupsOf(common)}
      label={common.label}
      searchPlaceholder={common.searchPlaceholder}
      emptyLabel={m.category_picker_empty()}
    >
      {children}
    </Combobox>
  );
}

export interface CategoryPickerProps extends PickerCommon {
  /** Labels the tiles (the visible "Kategori" / "Sumber pemasukan" heading). */
  readonly heading: string;
  readonly invalid?: boolean;
  /** The error under the tiles. */
  readonly describedBy?: string | undefined;
}

/**
 * The sheet's tiles (design `airjf`): the five most used categories and "Lainnya", which opens the search over all
 * of them and shows a category chosen there ("masuk Lainnya", `BJfbo`). "Lihat semua" opens the same search.
 */
export function CategoryPicker({ heading, invalid = false, describedBy, ...common }: CategoryPickerProps) {
  const more = useRef<HTMLButtonElement>(null);
  const frequent = frequentCategories(common.categories, common.kind);
  const tiles = frequent.slice(0, TILE_COUNT);
  const chosenElsewhere =
    common.value === null || tiles.some((category) => category.id === common.value)
      ? undefined
      : frequent.find((category) => category.id === common.value);
  const tile = `flex h-[62px] min-w-0 flex-col items-start justify-between rounded-[9px] border bg-input px-3 py-2.5 text-left text-[13px] text-text-secondary hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:border-violet aria-pressed:bg-violet-tint-1 aria-pressed:font-medium aria-pressed:text-fg ${invalid ? 'border-red' : 'border-border'}`;
  return (
    <div role="group" aria-label={heading} aria-describedby={describedBy} className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className={`text-[12.5px] font-medium ${invalid ? 'text-red-fg' : 'text-muted-fg'}`}>{heading}</span>
        <button
          type="button"
          onClick={() => more.current?.click()}
          className="rounded-[4px] text-[12px] text-muted-fg hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          {m.category_picker_see_all()}
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {tiles.map((category) => (
          <button
            key={category.id}
            type="button"
            aria-pressed={category.id === common.value}
            onClick={() => {
              common.onValueChange(category.id);
            }}
            className={tile}
          >
            <CategoryIcon icon={category.icon} color={category.color} size="sm" />
            <span className="w-full truncate">{categoryName(category)}</span>
          </button>
        ))}
        <CategorySearch {...common}>
          <button ref={more} type="button" aria-pressed={chosenElsewhere !== undefined} className={tile}>
            {chosenElsewhere === undefined ? (
              <CirclePlus aria-hidden="true" className="size-[18px] text-muted-fg" />
            ) : (
              <CategoryIcon icon={chosenElsewhere.icon} color={chosenElsewhere.color} size="sm" />
            )}
            <span className="w-full truncate">
              {chosenElsewhere === undefined ? m.category_picker_other() : categoryName(chosenElsewhere)}
            </span>
          </button>
        </CategorySearch>
      </div>
    </div>
  );
}

export interface CategorySelectProps extends PickerCommon, Omit<ComponentProps<'button'>, 'value'> {
  readonly placeholder: string;
}

/** A field-like category picker (Quick Add bar, transfer fee category). */
export function CategorySelect({
  categories,
  kind,
  value,
  onValueChange,
  label,
  searchPlaceholder,
  budgetNote,
  placeholder,
  className = '',
  ...props
}: CategorySelectProps) {
  const chosen = categories.find((category) => category.id === value);
  const common = { categories, kind, value, onValueChange, label, searchPlaceholder, ...(budgetNote ? { budgetNote } : {}) };
  return (
    <CategorySearch {...common}>
      <button
        type="button"
        {...props}
        className={`flex min-w-0 items-center gap-2 border border-border-input bg-input text-left text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-invalid:border-red ${className}`}
      >
        {chosen === undefined ? null : <CategoryIcon icon={chosen.icon} color={chosen.color} size="sm" />}
        <span className={`min-w-0 flex-1 truncate ${chosen === undefined ? 'text-subtle' : ''}`}>
          {chosen === undefined ? placeholder : categoryName(chosen)}
        </span>
        <ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 text-subtle" />
      </button>
    </CategorySearch>
  );
}
