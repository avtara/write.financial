// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Kategori baru" and "Edit kategori" (design `zGTve`/`PKbl5`, income variant `l3toE`): type, name (≤ 24),
 * group, icon, color, and the fixed-cost flag, with a live preview. Built-in names are translated, so they cannot
 * be renamed; system categories ("Biaya keuangan") keep their group. The monthly budget/target fields belong to
 * budgets (M2) and are not shown yet.
 */
import type { CategoryView } from '@wf/db/categories';
import { CATEGORY_NAME_MAX, GROUPS_BY_KIND, type CategoryGroup } from '@wf/domain/categories';
import { m } from '@wf/i18n/messages';
import { SegmentedControl } from '@wf/ui/segmented-control';
import { Switch } from '@wf/ui/switch';
import { ArrowDownLeft, ArrowUpRight, Check } from 'lucide-react';
import { useId, useState } from 'react';
import { colorProps } from '../../lib/colors.ts';
import { categoryGroupLabel, categoryName } from '../../lib/ledger-labels.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import type { Result } from '../../server/access.ts';
import { createCategory, moveCategory, updateCategory } from '../../server/fn/categories.ts';
import { CategoryIcon } from '../category-icon.tsx';
import { ColorPicker } from '../color-picker.tsx';
import { Button, Field, FormError, TextInput } from '../form.tsx';
import { IconPicker } from '../icon-picker.tsx';
import { Modal } from '../modal.tsx';
import { usePreferences } from '../preferences.tsx';
import { settle } from '../setup/result.ts';

/** Kinds a user creates; "Biaya keuangan" (`fee`) is the system group. */
export type EditableKind = 'expense' | 'income';

/** The dot of each group in the "Kelompok" cards and badges. */
export const GROUP_COLORS: Readonly<Record<CategoryGroup, string>> = {
  needs: 'blue',
  wants: 'violet',
  financial: 'subtle',
  active: 'green',
  passive: 'blue',
  other: 'subtle',
};

interface Draft {
  kind: EditableKind;
  name: string;
  group: CategoryGroup;
  icon: string;
  color: string;
  isFixed: boolean;
}

const NEW_DRAFT: Readonly<Record<EditableKind, Draft>> = {
  expense: { kind: 'expense', name: '', group: 'needs', icon: 'graduation-cap', color: 'cyan', isFixed: false },
  income: { kind: 'income', name: '', group: 'active', icon: 'presentation', color: 'green', isFixed: false },
};

export interface CategoryDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** `null` creates a category of `kind`. */
  readonly category: CategoryView | null;
  readonly kind: EditableKind;
  readonly onSaved: (category: CategoryView, created: boolean) => void;
}

function CategoryForm({
  category,
  kind,
  onKindChange,
  onCancel,
  onSaved,
}: Omit<CategoryDialogProps, 'open' | 'onOpenChange'> & {
  onKindChange: (kind: EditableKind) => void;
  onCancel: () => void;
}) {
  const { preferences } = usePreferences();
  const [draft, setDraft] = useState<Draft>(() =>
    category === null
      ? NEW_DRAFT[kind]
      : {
          kind: category.kind === 'income' ? 'income' : 'expense',
          name: categoryName(category),
          group: category.group,
          icon: category.icon,
          color: category.color,
          isFixed: category.isFixed,
        },
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const groupName = useId();

  const builtIn = category?.builtInKey !== null && category !== null;
  const fixedGroup = category?.isSystem === true;
  const groups = category?.kind === 'fee' ? GROUPS_BY_KIND.fee : GROUPS_BY_KIND[draft.kind];
  const change = (patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const submit = async () => {
    const name = draft.name.trim();
    if (!builtIn && name.length === 0) {
      setNameError(m.category_form_name_required());
      return;
    }
    setPending(true);
    setNameError(null);
    setError(null);
    let result: Result<CategoryView>;
    if (category === null) {
      const { kind: draftKind, group, icon, color, isFixed } = draft;
      result = await settle(() =>
        createCategory({
          data: { kind: draftKind, group, name, icon, color, isFixed: draftKind === 'expense' && isFixed },
        }),
      );
    } else {
      result = await settle(() =>
        updateCategory({
          data: {
            id: category.id,
            ...(builtIn ? {} : { name }),
            icon: draft.icon,
            color: draft.color,
            isFixed: draft.isFixed,
          },
        }),
      );
      if (result.ok && draft.group !== category.group) {
        result = await settle(() => moveCategory({ data: { id: category.id, group: draft.group } }));
      }
    }
    setPending(false);
    if (!result.ok) {
      const message = ledgerErrorMessage(result.code, preferences.locale);
      if (result.code === 'CATEGORY_NAME_TAKEN') setNameError(message);
      else setError(message);
      return;
    }
    onSaved(result.value, category === null);
  };

  const previewName = draft.name.trim() === '' ? m.category_form_name_placeholder() : draft.name.trim();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-4"
    >
      {category === null ? (
        <div className="flex flex-col gap-1.5">
          <span id={`${groupName}-kind`} className="text-[12.5px] font-medium text-muted-fg">
            {m.category_form_kind()}
          </span>
          <SegmentedControl<EditableKind>
            label={m.category_form_kind()}
            fill
            value={draft.kind}
            onValueChange={(next) => {
              setDraft((current) => ({ ...NEW_DRAFT[next], name: current.name }));
              onKindChange(next);
            }}
            options={[
              { value: 'expense', label: m.category_kind_expense(), icon: ArrowUpRight },
              { value: 'income', label: m.category_kind_income(), icon: ArrowDownLeft },
            ]}
          />
        </div>
      ) : null}

      <Field
        label={m.category_form_name()}
        aside={
          <span className="text-[11.5px] text-subtle">{m.category_form_name_max({ max: CATEGORY_NAME_MAX })}</span>
        }
        hint={builtIn ? m.category_form_name_builtin() : undefined}
        error={nameError}
      >
        {({ id, describedBy, invalid }) => (
          <div className="relative">
            <span className="absolute top-1/2 left-2 -translate-y-1/2">
              <CategoryIcon icon={draft.icon} color={draft.color} size="sm" />
            </span>
            <TextInput
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              maxLength={CATEGORY_NAME_MAX}
              autoComplete="off"
              placeholder={m.category_form_name_placeholder()}
              readOnly={builtIn}
              value={draft.name}
              onChange={(event) => {
                change({ name: event.target.value });
              }}
              className="pl-10 read-only:text-muted-fg"
            />
          </div>
        )}
      </Field>

      {fixedGroup ? null : (
        <fieldset className="flex min-w-0 flex-col">
          <legend className="pb-1.5 text-[12.5px] font-medium text-muted-fg">{m.category_form_group()}</legend>
          <div className={`grid gap-2 ${groups.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {groups.map((group) => (
              <label
                key={group}
                className="flex cursor-pointer items-center gap-2 rounded-[9px] border border-border px-3 py-2.5 text-[13px] font-medium text-fg hover:bg-muted has-checked:border-blue has-checked:bg-blue-tint-1 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring"
              >
                <input
                  type="radio"
                  name={groupName}
                  value={group}
                  checked={draft.group === group}
                  onChange={() => {
                    change({ group });
                  }}
                  className="size-3.5 accent-blue"
                />
                <span
                  {...colorProps(GROUP_COLORS[group])}
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-[var(--wf-color,var(--subtle))]"
                />
                {categoryGroupLabel(group)}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <IconPicker
        label={m.category_form_icon()}
        value={draft.icon}
        color={draft.color}
        onValueChange={(icon) => {
          change({ icon });
        }}
      />
      <ColorPicker
        label={m.category_form_color()}
        value={draft.color}
        onValueChange={(color) => {
          change({ color });
        }}
      />
      {draft.kind === 'expense' ? (
        <Switch
          label={m.category_form_fixed()}
          description={m.category_form_fixed_hint()}
          checked={draft.isFixed}
          onChange={(event) => {
            change({ isFixed: event.target.checked });
          }}
        />
      ) : null}

      <div
        aria-label={m.category_form_preview()}
        role="group"
        className="flex items-center gap-2.5 rounded-[9px] border border-border px-3 py-2.5"
      >
        <span className="text-[11.5px] text-subtle">{m.category_form_preview()}</span>
        <CategoryIcon icon={draft.icon} color={draft.color} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{previewName}</span>
        <span className="flex items-center gap-1.5 text-[11.5px] text-muted-fg">
          <span
            {...colorProps(GROUP_COLORS[draft.group])}
            aria-hidden="true"
            className="size-1.5 rounded-full bg-[var(--wf-color,var(--subtle))]"
          />
          {categoryGroupLabel(draft.group)}
        </span>
      </div>

      {error === null ? null : <FormError>{error}</FormError>}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          {m.settings_cancel()}
        </Button>
        <Button type="submit" size="sm" pending={pending}>
          <Check aria-hidden="true" className="size-3.5" />
          {category === null ? m.category_form_create() : m.settings_save()}
        </Button>
      </div>
    </form>
  );
}

export function CategoryDialog({ open, onOpenChange, category, kind, onSaved }: CategoryDialogProps) {
  // The type picked in the form names the dialog ("Kategori pemasukan baru"); every opening starts from `kind`.
  const [shownKind, setShownKind] = useState(kind);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setShownKind(kind);
  }
  let title = m.category_form_edit_title();
  let description = m.category_form_edit_description();
  if (category === null) {
    title = shownKind === 'income' ? m.category_form_new_income_title() : m.category_form_new_title();
    description = shownKind === 'income' ? m.category_form_new_income_description() : m.category_form_new_description();
  }
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} description={description} size="lg">
      <CategoryForm
        category={category}
        kind={kind}
        onKindChange={setShownKind}
        onSaved={onSaved}
        onCancel={() => {
          onOpenChange(false);
        }}
      />
    </Modal>
  );
}
