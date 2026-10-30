// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Semua rekening" (design `ycP7T` list, `Ik3il` ⋮ menu, `UiCq6` drag, `oed7u` archived tab): active accounts grouped
 * by type with group totals, reorderable by drag or keyboard within their group (FR-R6, dnd-kit announces the moves),
 * and the archived accounts with Restore and Delete permanently.
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
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { AccountView } from '@wf/db/accounts';
import { m } from '@wf/i18n/messages';
import { DateLabel } from '@wf/ui/date-label';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@wf/ui/dropdown-menu';
import { Money } from '@wf/ui/money';
import { useNavigate } from '@tanstack/react-router';
import {
  Archive,
  ArchiveRestore,
  ArrowLeftRight,
  EllipsisVertical,
  GripVertical,
  Info,
  Pencil,
  Scale,
  Trash2,
} from 'lucide-react';
import { useId, useMemo } from 'react';
import { accountMeta, groupByType, type AccountGroup } from '../../lib/accounts.ts';
import { accountTypeLabel } from '../../lib/ledger-labels.ts';
import { Button } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';
import type { AccountFlag } from './account-detail.tsx';
import { AccountLogo } from './account-logo.tsx';
import { ApproxBalance } from './approx-balance.tsx';

export interface AccountActions {
  readonly onSelect: (account: AccountView) => void;
  readonly onEdit: (account: AccountView) => void;
  readonly onReconcile: (account: AccountView) => void;
  readonly onArchive: (account: AccountView) => void;
  readonly onToggle: (account: AccountView, flag: AccountFlag, value: boolean) => void;
}

export interface AccountListProps extends AccountActions {
  /** Active accounts in their saved order. */
  readonly accounts: readonly AccountView[];
  readonly baseCurrency: string;
  readonly selectedId: string | null;
  /** Another account already holds the third card slot. */
  /** The new order of every active account. */
  readonly onReorder: (ids: string[]) => void;
}

/** The order of every active account after moving `activeId` onto `overId` within their group. */
export function reorderedIds(
  groups: readonly AccountGroup[],
  active: UniqueIdentifier,
  over: { readonly id: UniqueIdentifier } | null,
): string[] | null {
  if (over === null) return null;
  const activeId = String(active);
  const overId = String(over.id);
  const group = groups.find((candidate) => candidate.accounts.some((account) => account.id === activeId));
  const ids = group?.accounts.map((account) => account.id) ?? [];
  const to = ids.indexOf(overId);
  if (group === undefined || to === -1 || activeId === overId) return null;
  const moved = arrayMove(ids, ids.indexOf(activeId), to);
  return groups.flatMap((candidate) => (candidate === group ? moved : candidate.accounts.map((account) => account.id)));
}

/** What dnd-kit announces while an account is moved (FR-R6 keyboard sorting). */
export function dragAnnouncements(accounts: readonly AccountView[]): Announcements {
  const nameOf = (id: string | number) => accounts.find((account) => account.id === id)?.displayName ?? '';
  return {
    onDragStart: ({ active }) => m.accounts_drag_start({ name: nameOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over === null ? undefined : m.accounts_drag_over({ name: nameOf(active.id), target: nameOf(over.id) }),
    onDragEnd: ({ active, over }) =>
      over === null ? undefined : m.accounts_drag_end({ name: nameOf(active.id), target: nameOf(over.id) }),
    onDragCancel: ({ active }) => m.accounts_drag_cancel({ name: nameOf(active.id) }),
  };
}

export function AccountList({ accounts, baseCurrency, selectedId, onReorder, ...actions }: AccountListProps) {
  const { preferences } = usePreferences();
  // A stable id keeps dnd-kit's `aria-describedby` the same on the server and the client.
  const dndId = useId();
  const groups = useMemo(() => groupByType(accounts), [accounts]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const end = ({ active, over }: DragEndEvent) => {
    const ids = reorderedIds(groups, active.id, over);
    if (ids !== null) onReorder(ids);
  };

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={end}
      accessibility={{
        announcements: dragAnnouncements(accounts),
        screenReaderInstructions: { draggable: m.accounts_drag_instructions() },
      }}
    >
      <div className="flex flex-col">
        <div aria-hidden="true" className="flex justify-between bg-surface-sunken px-4 py-2 text-[11.5px] text-subtle">
          <span className="pl-6">{m.accounts_column_account()}</span>
          <span className="pr-7">{m.accounts_column_balance()}</span>
        </div>
        {groups.map((group) => {
          const foreign = group.accounts.some((account) => account.currency !== baseCurrency);
          return (
            <section key={group.type} aria-labelledby={`account-group-${group.type}`}>
              <div className="flex items-center gap-2 px-4 pt-3 pb-1.5 text-[11px]">
                <h3
                  id={`account-group-${group.type}`}
                  className="font-semibold tracking-[0.06em] text-muted-fg uppercase"
                >
                  {accountTypeLabel(group.type)}
                </h3>
                <span className="text-subtle">{m.accounts_count({ count: group.accounts.length })}</span>
                {group.type === 'investment' ? (
                  <span className="rounded-[4px] border border-border px-1.5 text-[10.5px] text-subtle">
                    {m.accounts_not_in_available()}
                  </span>
                ) : null}
                <span className="ml-auto pr-7 font-mono text-muted-fg">
                  {foreign ? '≈ ' : ''}
                  <Money
                    minor={group.totalBaseMinor}
                    currency={baseCurrency}
                    context="amount"
                    locale={preferences.locale}
                  />
                </span>
              </div>
              <SortableContext
                items={group.accounts.map((account) => account.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="flex flex-col">
                  {group.accounts.map((account) => (
                    <SortableRow
                      key={account.id}
                      account={account}
                      baseCurrency={baseCurrency}
                      selected={account.id === selectedId}
                      {...actions}
                    />
                  ))}
                </ul>
              </SortableContext>
            </section>
          );
        })}
      </div>
    </DndContext>
  );
}

/** "•• 4821 · BCA" under the name in the list. */
function rowMeta(account: AccountView): string {
  const parts = [
    account.last4 === null ? account.phoneMasked : `•• ${account.last4}`,
    account.providerName === account.displayName || account.type === 'cash' ? null : account.providerName,
  ];
  return parts.filter((part) => part !== null).join(' · ');
}

function SortableRow({
  account,
  baseCurrency,
  selected,
  onSelect,
  onEdit,
  onReconcile,
  onArchive,
  onToggle,
}: AccountActions & { account: AccountView; baseCurrency: string; selected: boolean }) {
  const { preferences } = usePreferences();
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: account.id,
  });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group relative flex items-center gap-2 border-t border-border px-2 py-2.5 ${selected ? 'bg-tint-04' : ''} ${isDragging ? 'z-10 bg-surface-3 shadow-[0_8px_24px_var(--shadow)]' : ''}`}
    >
      {selected ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5 bg-fg" /> : null}
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-label={m.accounts_drag_handle({ name: account.displayName })}
        // A finger drags the handle instead of scrolling the page; touch screens always show it at 40 px (FR-TB4).
        className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-[5px] text-subtle opacity-60 group-hover:opacity-100 hover:bg-muted focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:size-10 pointer-coarse:opacity-100"
      >
        <GripVertical aria-hidden="true" className="size-3.5" />
      </button>
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={() => {
          onSelect(account);
        }}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-[6px] text-left focus-visible:outline-2 focus-visible:outline-ring"
      >
        <AccountLogo account={account} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13.5px] font-medium text-fg">{account.displayName}</span>
            <span
              className={`rounded-[4px] border px-1 font-mono text-[10px] ${account.currency === 'IDR' ? 'border-border text-subtle' : 'border-blue-tint-2 text-blue-fg'}`}
            >
              {account.currency}
            </span>
          </span>
          <span className="truncate text-[11.5px] text-subtle">{rowMeta(account)}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <Money
            minor={account.balanceMinor}
            currency={account.currency}
            context="amount"
            locale={preferences.locale}
            className="text-[13.5px] font-medium text-fg"
          />
          <ApproxBalance account={account} baseCurrency={baseCurrency} />
        </span>
      </button>
      <div>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={m.accounts_menu({ name: account.displayName })}
            className="flex size-7 items-center justify-center rounded-[6px] text-subtle hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
          >
            <EllipsisVertical aria-hidden="true" className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem
                icon={Pencil}
                onSelect={() => {
                  onEdit(account);
                }}
              >
                {m.accounts_menu_edit()}
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={Scale}
                onSelect={() => {
                  onReconcile(account);
                }}
              >
                {m.accounts_adjust()}
              </DropdownMenuItem>
              <DropdownMenuItem
                icon={ArrowLeftRight}
                onSelect={() => {
                  void navigate({ to: '/transactions', search: { account: account.id } });
                }}
              >
                {m.accounts_view_transactions()}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuCheckboxItem
                indicator="switch"
                checked={account.includeInAvailable}
                onCheckedChange={(value) => {
                  onToggle(account, 'includeInAvailable', value);
                }}
              >
                {m.accounts_menu_available()}
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                icon={Archive}
                variant="destructive"
                onSelect={() => {
                  onArchive(account);
                }}
              >
                {m.accounts_menu_archive()}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

export interface ArchivedListProps {
  readonly accounts: readonly AccountView[];
  readonly timeZone: string;
  readonly selectedId: string | null;
  readonly onSelect: (account: AccountView) => void;
  readonly onRestore: (account: AccountView) => void;
  readonly onDelete: (account: AccountView) => void;
}

export function ArchivedList({ accounts, timeZone, selectedId, onSelect, onRestore, onDelete }: ArchivedListProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  if (accounts.length === 0) {
    return <p className="px-4 py-8 text-center text-[13px] text-subtle">{m.accounts_archived_empty()}</p>;
  }
  return (
    <div className="flex flex-col">
      <ul aria-label={m.accounts_archived_title()} className="flex flex-col">
        {accounts.map((account) => (
          <li
            key={account.id}
            aria-current={account.id === selectedId ? 'true' : undefined}
            className="flex items-center gap-3 border-t border-border px-4 py-3 aria-[current=true]:bg-tint-04"
          >
            <button
              type="button"
              onClick={() => {
                onSelect(account);
              }}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-[6px] text-left focus-visible:outline-2 focus-visible:outline-ring"
            >
              <AccountLogo account={account} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-[13.5px] font-medium text-fg">{account.displayName}</span>
                  <span className="rounded-[4px] bg-tint-06 px-1.5 text-[10.5px] text-muted-fg">
                    {m.accounts_archived_badge()}
                  </span>
                </span>
                <span className="truncate text-[11.5px] text-subtle">
                  {accountMeta(account)} · {m.accounts_transaction_count({ count: account.transactionCount })}
                </span>
              </span>
            </button>
            <span className="flex shrink-0 items-center gap-1 text-[12px] text-muted-fg">
              {account.archivedAt === null ? null : (
                <DateLabel instant={account.archivedAt} timeZone={timeZone} locale={locale} format="date" />
              )}
              <span>· {m.accounts_archived_balance()}</span>
              <Money minor={account.balanceMinor} currency={account.currency} context="amount" locale={locale} />
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                onRestore(account);
              }}
            >
              <ArchiveRestore aria-hidden="true" className="size-3.5" />
              {m.accounts_restore()}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-red-fg hover:text-red-fg"
              onClick={() => {
                onDelete(account);
              }}
            >
              <Trash2 aria-hidden="true" className="size-3.5" />
              {m.accounts_delete()}
            </Button>
          </li>
        ))}
      </ul>
      <p className="flex items-start gap-2 border-t border-border px-4 py-3 text-[12px] text-subtle">
        <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        {m.accounts_archived_note()}
      </p>
    </div>
  );
}
