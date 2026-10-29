// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The Overview's customizable cards (FR-D3): a 3-column grid from 1280 px (each card ⅓, ⅔, or full width; one
 * column below), and "Atur dashboard" — the edit mode (design `iBCvF`, `e1r8q`) with a ⋮⋮ handle to drag a card (or
 * move it with the keyboard; dnd-kit announces the moves), the eye to hide or show it, its width, and the cards that
 * can still be added; plus "Kelola kartu" (design `GcXr5`), the same controls as one sortable list. Nothing here
 * saves: the page holds the draft and saves it with "Simpan tata letak".
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
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { m } from '@wf/i18n/messages';
import { SegmentedControl } from '@wf/ui/segmented-control';
import { Sheet } from '@wf/ui/sheet';
import { Switch } from '@wf/ui/switch';
import { Eye, EyeOff, GripVertical, Plus } from 'lucide-react';
import { useId, type CSSProperties, type ReactNode } from 'react';
import {
  ADDABLE_CARDS,
  moveCard,
  updateCard,
  type CardWidth,
  type DashboardCard,
  type DashboardCardPrefs,
  type DashboardLayout,
} from '../../lib/dashboard-layout.ts';

/** Each card's name, as its heading reads. */
export const CARD_NAME: Readonly<Record<DashboardCard, () => string>> = {
  accounts: m.accounts_title,
  flow: m.overview_flow_title,
  categories: m.overview_categories_title,
  cashflow: m.overview_cashflow_title,
  budget: m.overview_budget_title,
  calendar: m.overview_calendar_title,
  subscriptions: m.overview_subs_title,
  goals: m.overview_card_goals_title,
  bills: m.overview_card_bills_title,
};

/** What each card shows, under its name in "Kelola kartu" and "Kartu lain yang bisa ditambahkan". */
const CARD_CAPTION: Readonly<Record<DashboardCard, () => string>> = {
  accounts: m.dashboard_caption_accounts,
  flow: m.dashboard_caption_flow,
  categories: m.dashboard_caption_categories,
  cashflow: m.dashboard_caption_cashflow,
  budget: m.dashboard_caption_budget,
  calendar: m.dashboard_caption_calendar,
  subscriptions: m.dashboard_caption_subscriptions,
  goals: m.overview_card_goals_caption,
  bills: m.overview_card_bills_caption,
};

const SPAN: Readonly<Record<CardWidth, string>> = {
  third: 'xl:col-span-1',
  twoThirds: 'xl:col-span-2',
  full: 'xl:col-span-3',
};

const GRID = 'grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-3';
const ICON_BUTTON =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-[7px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:size-10';

/** An addable card that is off sits in "Kartu lain yang bisa ditambahkan", not in the grid. */
const placed = (card: DashboardCardPrefs) => card.visible || !ADDABLE_CARDS.includes(card.id);

const nameOf = (id: UniqueIdentifier) => CARD_NAME[id as DashboardCard]();

/** dnd-kit's announcements, with the cards' names instead of their ids. */
export const DRAG_ANNOUNCEMENTS: Announcements = {
  onDragStart: ({ active }) => m.dashboard_drag_start({ name: nameOf(active.id) }),
  onDragOver: ({ active, over }) =>
    over === null ? undefined : m.dashboard_drag_over({ name: nameOf(active.id), target: nameOf(over.id) }),
  onDragEnd: ({ active, over }) =>
    over === null ? undefined : m.dashboard_drag_end({ name: nameOf(active.id), target: nameOf(over.id) }),
  onDragCancel: ({ active }) => m.dashboard_drag_cancel({ name: nameOf(active.id) }),
};

function useCardSensors() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

interface SortableCardsProps {
  readonly layout: DashboardLayout;
  readonly onChange: (layout: DashboardLayout) => void;
  readonly vertical?: boolean;
  readonly children: ReactNode;
}

/** The drag-and-drop context shared by the edit-mode grid and the "Kelola kartu" list. */
function SortableCards({ layout, onChange, vertical = false, children }: SortableCardsProps) {
  // A stable id keeps dnd-kit's `aria-describedby` the same on the server and the client.
  const dndId = useId();
  const sensors = useCardSensors();
  const end = ({ active, over }: DragEndEvent) => {
    const next = moveCard(layout, active.id as DashboardCard, over);
    // Dropped where it was: no change to report ("Simpan tata letak" stays off).
    if (next !== layout) onChange(next);
  };
  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={end}
      accessibility={{
        announcements: DRAG_ANNOUNCEMENTS,
        screenReaderInstructions: { draggable: m.dashboard_drag_instructions() },
      }}
    >
      <SortableContext
        items={layout.cards.filter(placed).map((card) => card.id)}
        strategy={vertical ? verticalListSortingStrategy : rectSortingStrategy}
      >
        {children}
      </SortableContext>
    </DndContext>
  );
}

function WidthControl({
  card,
  onChange,
}: {
  readonly card: DashboardCardPrefs;
  readonly onChange: (width: CardWidth) => void;
}) {
  return (
    <SegmentedControl
      label={m.dashboard_card_width({ name: CARD_NAME[card.id]() })}
      value={card.width}
      onValueChange={onChange}
      options={[
        { value: 'third', label: m.dashboard_width_third() },
        { value: 'twoThirds', label: m.dashboard_width_two_thirds() },
        { value: 'full', label: m.dashboard_width_full() },
      ]}
    />
  );
}

export interface DashboardGridProps {
  readonly layout: DashboardLayout;
  /** The card's content; `null` leaves it out (e.g. its data failed to load). */
  readonly render: (id: DashboardCard) => ReactNode;
}

/** The cards as the user arranged them: the shown ones, in order, at their widths. */
export function DashboardGrid({ layout, render }: DashboardGridProps) {
  return (
    <div className={GRID}>
      {layout.cards
        .filter((card) => card.visible)
        .map((card) => {
          const content = render(card.id);
          return content === null ? null : (
            <div key={card.id} data-card={card.id} className={`min-w-0 *:h-full ${SPAN[card.width]}`}>
              {content}
            </div>
          );
        })}
    </div>
  );
}

export interface DashboardEditorProps {
  readonly layout: DashboardLayout;
  readonly onChange: (layout: DashboardLayout) => void;
  readonly render: (id: DashboardCard) => ReactNode;
}

/** Edit mode: every placed card with its handle, width, and eye; hidden ones as a placeholder; then the addable ones. */
export function DashboardEditor({ layout, onChange, render }: DashboardEditorProps) {
  const addable = layout.cards.filter((card) => !placed(card));
  return (
    <div className="flex flex-col gap-4">
      <SortableCards layout={layout} onChange={onChange}>
        <div className={GRID}>
          {layout.cards.filter(placed).map((card) => (
            <EditableCard key={card.id} card={card} layout={layout} onChange={onChange}>
              {card.visible ? render(card.id) : null}
            </EditableCard>
          ))}
        </div>
      </SortableCards>
      {addable.length === 0 ? null : (
        <section aria-labelledby="dashboard-addable" className="flex flex-col gap-3">
          <h2 id="dashboard-addable" className="text-[13px] font-semibold text-muted-fg">
            {m.dashboard_addable_title()}
          </h2>
          <ul className="grid gap-3 md:grid-cols-3">
            {addable.map((card) => (
              <li
                key={card.id}
                className="flex items-center justify-between gap-3 rounded-[12px] border border-dashed border-border-strong px-4 py-3"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="text-[13px] font-medium text-fg">{CARD_NAME[card.id]()}</span>
                  <span className="text-[12px] text-subtle">{CARD_CAPTION[card.id]()}</span>
                </span>
                <button
                  type="button"
                  aria-label={m.dashboard_add_card({ name: CARD_NAME[card.id]() })}
                  onClick={() => {
                    onChange(updateCard(layout, card.id, { visible: true }));
                  }}
                  className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[7px] border border-border px-2.5 text-[12.5px] text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:h-10"
                >
                  <Plus aria-hidden="true" className="size-3.5" />
                  {m.dashboard_add()}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

interface EditableCardProps {
  readonly card: DashboardCardPrefs;
  readonly layout: DashboardLayout;
  readonly onChange: (layout: DashboardLayout) => void;
  /** The card's content; `null` while it is hidden. */
  readonly children: ReactNode;
}

function EditableCard({ card, layout, onChange, children }: EditableCardProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
  });
  const name = CARD_NAME[card.id]();
  return (
    <div
      ref={setNodeRef}
      data-card={card.id}
      // dnd-kit moves the card through the CSSOM (allowed by the CSP, unlike a `style` attribute in the markup).
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`flex min-w-0 flex-col gap-2 rounded-[14px] border border-dashed border-border-strong p-2 ${SPAN[card.width]} ${isDragging ? 'z-10 bg-surface-3 shadow-[0_8px_24px_var(--shadow)]' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={m.dashboard_move_card({ name })}
          className={`${ICON_BUTTON} cursor-grab touch-none`}
        >
          <GripVertical aria-hidden="true" className="size-4" />
        </button>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-fg">{name}</span>
        <WidthControl
          card={card}
          onChange={(width) => {
            onChange(updateCard(layout, card.id, { width }));
          }}
        />
        <button
          type="button"
          aria-label={card.visible ? m.dashboard_hide_card({ name }) : m.dashboard_show_card({ name })}
          onClick={() => {
            onChange(updateCard(layout, card.id, { visible: !card.visible }));
          }}
          className={ICON_BUTTON}
        >
          {card.visible ? (
            <Eye aria-hidden="true" className="size-4" />
          ) : (
            <EyeOff aria-hidden="true" className="size-4" />
          )}
        </button>
      </div>
      {card.visible ? (
        // A preview: its links and buttons do nothing while the layout is edited.
        <div inert className="pointer-events-none">
          {children}
        </div>
      ) : (
        <p className="rounded-[10px] bg-surface-sunken px-4 py-6 text-center text-[12.5px] text-subtle">
          {m.dashboard_card_hidden()}
        </p>
      )}
    </div>
  );
}

export interface ManageCardsProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly layout: DashboardLayout;
  readonly onChange: (layout: DashboardLayout) => void;
}

/** "Kelola kartu": every card as a row (drag to order, switch to show, width), the addable ones last. */
export function ManageCards({ open, onOpenChange, layout, onChange }: ManageCardsProps) {
  const ordered = layout.cards.filter(placed);
  const addable = layout.cards.filter((card) => !placed(card));
  const props = { layout, onChange };
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={m.dashboard_manage_title()}
      description={m.dashboard_manage_description()}
      closeLabel={m.dashboard_cancel()}
    >
      <div className="flex flex-col gap-5">
        <p className="text-[12.5px] text-subtle">{m.dashboard_manage_pinned()}</p>
        <section aria-labelledby="dashboard-manage-order" className="flex flex-col gap-2">
          <h3
            id="dashboard-manage-order"
            className="text-[11px] font-semibold tracking-[0.06em] text-muted-fg uppercase"
          >
            {m.dashboard_manage_order()}
          </h3>
          <SortableCards layout={layout} onChange={onChange} vertical>
            <ul className="flex flex-col gap-2">
              {ordered.map((card) => (
                <SortableManageRow key={card.id} card={card} {...props} />
              ))}
            </ul>
          </SortableCards>
        </section>
        {addable.length === 0 ? null : (
          <section aria-labelledby="dashboard-manage-addable" className="flex flex-col gap-2">
            <h3
              id="dashboard-manage-addable"
              className="text-[11px] font-semibold tracking-[0.06em] text-muted-fg uppercase"
            >
              {m.dashboard_manage_addable()}
            </h3>
            <ul className="flex flex-col gap-2">
              {addable.map((card) => (
                <ManageRow key={card.id} card={card} {...props} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  );
}

interface ManageRowProps {
  readonly card: DashboardCardPrefs;
  readonly layout: DashboardLayout;
  readonly onChange: (layout: DashboardLayout) => void;
}

/** A row of the order, with its ⋮⋮ handle. */
function SortableManageRow(props: ManageRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } = useSortable({
    id: props.card.id,
  });
  return (
    <ManageRow
      {...props}
      rowRef={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      handle={
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={m.dashboard_move_card({ name: CARD_NAME[props.card.id]() })}
          className={`${ICON_BUTTON} cursor-grab touch-none`}
        >
          <GripVertical aria-hidden="true" className="size-4" />
        </button>
      }
    />
  );
}

interface RowLayoutProps {
  readonly rowRef?: (node: HTMLElement | null) => void;
  readonly style?: CSSProperties;
  readonly handle?: ReactNode;
}

/** A card's switch (shown) and width; an addable card not added yet joins the order once switched on. */
function ManageRow({ card, layout, onChange, rowRef, style, handle }: ManageRowProps & RowLayoutProps) {
  return (
    <li
      ref={rowRef}
      style={style}
      className="flex flex-wrap items-center gap-3 rounded-[10px] border border-border bg-card px-3 py-2.5"
    >
      {handle}
      <Switch
        className="min-w-0 flex-1"
        label={CARD_NAME[card.id]()}
        description={CARD_CAPTION[card.id]()}
        checked={card.visible}
        onChange={(event) => {
          onChange(updateCard(layout, card.id, { visible: event.currentTarget.checked }));
        }}
      />
      <WidthControl
        card={card}
        onChange={(width) => {
          onChange(updateCard(layout, card.id, { width }));
        }}
      />
    </li>
  );
}
