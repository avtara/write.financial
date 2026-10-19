// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FR-K2 "Gabungkan dengan…": pick another live category of the same kind; the source's transactions move there and
 * the source is deleted. System categories are never offered as a source (the menu hides the action), but they can
 * be the target.
 */
import type { CategoryView } from '@wf/db/categories';
import { m } from '@wf/i18n/messages';
import { Select } from '@wf/ui/select';
import { Merge } from 'lucide-react';
import { useState } from 'react';
import { categoryGroupLabel, categoryName } from '../../lib/ledger-labels.ts';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { mergeCategories } from '../../server/fn/categories.ts';
import { Button, Field, FormError } from '../form.tsx';
import { Modal } from '../modal.tsx';
import { usePreferences } from '../preferences.tsx';
import { settle } from '../setup/result.ts';

export interface CategoryMergeDialogProps {
  /** The category to merge away; `null` keeps the dialog closed. */
  readonly source: CategoryView | null;
  readonly categories: readonly CategoryView[];
  readonly onClose: () => void;
  readonly onMerged: (source: CategoryView, target: CategoryView, moved: number) => void;
}

function MergeForm({ source, categories, onClose, onMerged }: CategoryMergeDialogProps & { source: CategoryView }) {
  const { preferences } = usePreferences();
  const targets = categories.filter(
    (category) => category.kind === source.kind && category.id !== source.id && category.archivedAt === null,
  );
  const [targetId, setTargetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const target = targets.find((category) => category.id === targetId);

  const submit = async (into: CategoryView) => {
    setPending(true);
    setError(null);
    const result = await settle(() => mergeCategories({ data: { sourceId: source.id, targetId: into.id } }));
    setPending(false);
    if (!result.ok) {
      setError(ledgerErrorMessage(result.code, preferences.locale));
      return;
    }
    onMerged(source, into, result.value.moved);
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (target !== undefined) void submit(target);
      }}
      className="flex flex-col gap-4"
    >
      <Field label={m.category_merge_target()}>
        {({ id }) => (
          <Select
            id={id}
            value={targetId}
            onValueChange={setTargetId}
            placeholder={m.category_merge_placeholder()}
            options={targets.map((category) => ({
              value: category.id,
              label: categoryName(category),
              description: categoryGroupLabel(category.group),
            }))}
          />
        )}
      </Field>
      {target === undefined ? null : (
        <p role="status" className="rounded-[8px] bg-amber-tint-2 px-3 py-2 text-[12.5px] text-amber-fg">
          {m.category_merge_impact({
            count: source.transactionCount,
            source: categoryName(source),
            target: categoryName(target),
          })}
        </p>
      )}
      {error === null ? null : <FormError>{error}</FormError>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onClose}>
          {m.settings_cancel()}
        </Button>
        <Button type="submit" size="sm" pending={pending} disabled={target === undefined}>
          <Merge aria-hidden="true" className="size-3.5" />
          {m.category_merge_submit()}
        </Button>
      </div>
    </form>
  );
}

export function CategoryMergeDialog(props: CategoryMergeDialogProps) {
  const { source, onClose } = props;
  return (
    <Modal
      open={source !== null}
      onOpenChange={onClose}
      title={source === null ? '' : m.category_merge_title({ name: categoryName(source) })}
      description={m.category_merge_description()}
    >
      {source === null ? null : <MergeForm {...props} source={source} />}
    </Modal>
  );
}
