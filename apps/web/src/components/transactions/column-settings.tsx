// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Atur kolom" (FR-L2, design `q1t7n8`): the table's columns in order — reorder by drag or keyboard (grip, Space,
 * ↑/↓, Space; dnd-kit announces the moves), switch the optional ones on and off ("Deskripsi" and "Jumlah" are locked),
 * pick the density (Nyaman/Padat), or go back to the defaults. Every change is handed to `onChange` at once.
 */
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Over,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { m } from '@wf/i18n/messages';
import { Popover, PopoverContent, PopoverTrigger } from '@wf/ui/popover';
import { Switch } from '@wf/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@wf/ui/tabs';
import { GripVertical, Lock, SlidersHorizontal } from 'lucide-react';
import { useId } from 'react';
import {
  DEFAULT_TABLE_PREFS,
  DENSITIES,
  LOCKED_COLUMNS,
  type Density,
  type TablePrefs,
  type TransactionColumn,
} from '../../lib/transaction-columns.ts';

/** The columns' names in "Atur kolom" (the header row uses shorter ones for some). */
export const COLUMN_LABELS: Readonly<Record<TransactionColumn, () => string>> = {
  time: m.transactions_columns_time,
  description: m.transactions_columns_description,
  tags: m.transactions_columns_tags,
  category: m.transactions_columns_category,
  account: m.transactions_columns_account,
  amount: m.transactions_columns_amount,
  attachment: m.transactions_columns_attachment,
  balance: m.transactions_columns_balance,
  source: m.transactions_columns_source,
};

const DENSITY_LABELS: Readonly<Record<Density, () => string>> = {
  comfortable: m.transactions_columns_density_comfortable,
  compact: m.transactions_columns_density_compact,
};

/** The prefs after dragging `active` onto `over`; `null` when nothing moves. */
export function reorderedColumns(
  prefs: TablePrefs,
  active: string | number,
  over: Pick<Over, 'id'> | null,
): TablePrefs | null {
  const ids = prefs.columns.map((column) => column.id as string);
  const from = ids.indexOf(String(active));
  const to = over === null ? -1 : ids.indexOf(String(over.id));
  if (from === -1 || to === -1 || from === to) return null;
  return { ...prefs, columns: arrayMove(prefs.columns, from, to) };
}

/** What dnd-kit announces while a column moves. */
export function columnAnnouncements(): Announcements {
  const nameOf = (id: string | number) => COLUMN_LABELS[id as TransactionColumn]();
  return {
    onDragStart: ({ active }) => m.transactions_columns_drag_start({ name: nameOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over === null
        ? undefined
        : m.transactions_columns_drag_over({ name: nameOf(active.id), target: nameOf(over.id) }),
    onDragEnd: ({ active, over }) =>
      over === null ? undefined : m.transactions_columns_drag_end({ name: nameOf(active.id), target: nameOf(over.id) }),
    onDragCancel: ({ active }) => m.transactions_columns_drag_cancel({ name: nameOf(active.id) }),
  };
}

function ColumnRow({
  id,
  visible,
  onToggle,
}: {
  readonly id: TransactionColumn;
  readonly visible: boolean;
  readonly onToggle: (visible: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const name = COLUMN_LABELS[id]();
  const locked = LOCKED_COLUMNS.includes(id);
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex h-8 items-center gap-2 rounded-[6px] pr-1.5 hover:bg-muted ${isDragging ? 'z-10 bg-surface-3 shadow-[0_8px_24px_var(--shadow)]' : ''}`}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={m.transactions_columns_drag_handle({ name })}
        // A finger drags the handle instead of scrolling the list; 40 px on touch screens (FR-TB4).
        className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-[5px] text-subtle focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:size-10"
      >
        <GripVertical aria-hidden="true" className="size-3.5" />
      </button>
      {locked ? (
        <span className="flex flex-1 items-center justify-between text-[13px] text-fg">
          {name}
          <Lock role="img" aria-label={m.transactions_columns_locked({ name })} className="size-3.5 text-subtle" />
        </span>
      ) : (
        <Switch
          label={name}
          checked={visible}
          onChange={(event) => {
            onToggle(event.target.checked);
          }}
          className="flex-1"
        />
      )}
    </li>
  );
}

export interface ColumnSettingsProps {
  readonly prefs: TablePrefs;
  readonly onChange: (prefs: TablePrefs) => void;
}

export function ColumnSettings({ prefs, onChange }: ColumnSettingsProps) {
  // A stable id keeps dnd-kit's `aria-describedby` the same on the server and the client.
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const end = ({ active, over }: DragEndEvent) => {
    const next = reorderedColumns(prefs, active.id, over);
    if (next !== null) onChange(next);
  };
  return (
    <Popover>
      <PopoverTrigger
        aria-label={m.transactions_columns_trigger()}
        className="flex size-8 shrink-0 items-center justify-center rounded-[8px] border border-border text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring data-[state=open]:border-border-strong data-[state=open]:text-fg"
      >
        <SlidersHorizontal aria-hidden="true" className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[268px]" aria-label={m.transactions_columns_trigger()}>
        <p className="px-3 pt-2.5 pb-1 text-[10.5px] text-subtle">
          <span className="font-medium tracking-wide uppercase">{m.transactions_columns_heading()}</span>
          {' · '}
          {m.transactions_columns_hint()}
        </p>
        <DndContext
          id={dndId}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={end}
          accessibility={{
            announcements: columnAnnouncements(),
            screenReaderInstructions: { draggable: m.transactions_columns_drag_instructions() },
          }}
        >
          <SortableContext items={prefs.columns.map((column) => column.id)} strategy={verticalListSortingStrategy}>
            <ul className="flex flex-col px-1.5 pb-1.5">
              {prefs.columns.map((column) => (
                <ColumnRow
                  key={column.id}
                  id={column.id}
                  visible={column.visible}
                  onToggle={(visible) => {
                    onChange({
                      ...prefs,
                      columns: prefs.columns.map((other) => (other.id === column.id ? { ...other, visible } : other)),
                    });
                  }}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
        <div className="flex items-center justify-between border-t border-border px-3 py-2">
          <span className="text-[13px] text-text-secondary">{m.transactions_columns_density()}</span>
          <Tabs
            value={prefs.density}
            onValueChange={(density) => {
              onChange({ ...prefs, density: density as Density });
            }}
          >
            <TabsList label={m.transactions_columns_density()}>
              {DENSITIES.map((density) => (
                <TabsTrigger key={density} value={density} panel={false} className="py-1 text-[12px]">
                  {DENSITY_LABELS[density]()}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <div className="border-t border-border p-1.5">
          <button
            type="button"
            onClick={() => {
              onChange(DEFAULT_TABLE_PREFS);
            }}
            className="flex h-8 w-full items-center rounded-[6px] px-2 text-left text-[13px] text-text-secondary hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
          >
            {m.transactions_columns_reset()}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
