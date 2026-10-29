// SPDX-License-Identifier: AGPL-3.0-only
/** Editable counterpart to @wf/ui/command's picker: bounded suggestions without replacing manual entry. */
import { searchCatalog, type CatalogKind, type CatalogRecord } from '@wf/domain/catalog';
import type { AccountType } from '@wf/domain/ledger';
import { m } from '@wf/i18n/messages';
import { Popover, PopoverAnchor, PopoverContent } from '@wf/ui/popover';
import { useId, useRef, useState } from 'react';
import { TextInput, type TextInputProps } from './form.tsx';

export interface CatalogInputProps extends Omit<
  TextInputProps,
  'value' | 'onChange' | 'onSelect' | 'onFocus' | 'onBlur' | 'onKeyDown'
> {
  readonly value: string;
  readonly kind: CatalogKind;
  readonly accountType?: AccountType;
  readonly currency?: string;
  readonly onValueChange: (value: string) => void;
  readonly onSelect: (record: CatalogRecord) => void;
}

export function CatalogInput({
  value,
  kind,
  accountType,
  currency,
  onValueChange,
  onSelect,
  ...props
}: CatalogInputProps) {
  const listId = useId();
  const hintId = `${listId}-hint`;
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const results = searchCatalog(value, {
    kind,
    ...(accountType === undefined ? {} : { accountType }),
    ...(currency === undefined ? {} : { currency }),
  });
  const hasQuery = value.trim() !== '';
  const expanded = open && hasQuery && results.length > 0;
  const active = results.findIndex((record) => record.id === activeId);
  const choose = (record: CatalogRecord) => {
    onSelect(record);
    setOpen(false);
    setActiveId(null);
  };
  return (
    <Popover
      open={expanded}
      onOpenChange={(next) => {
        setOpen(next);
        setActiveId(null);
      }}
    >
      <div className="min-w-0 flex-1">
        <PopoverAnchor asChild>
          <div ref={anchor}>
            <TextInput
              {...props}
              value={value}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={expanded}
              aria-controls={expanded ? listId : undefined}
              aria-activedescendant={expanded && active >= 0 ? `${listId}-${String(active)}` : undefined}
              aria-describedby={[props['aria-describedby'], hintId].filter(Boolean).join(' ')}
              autoComplete="off"
              onBlur={() => {
                setOpen(false);
                setActiveId(null);
              }}
              onChange={(event) => {
                onValueChange(event.currentTarget.value);
                setActiveId(null);
                setOpen(true);
              }}
              onKeyDown={(event) => {
                if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && results.length > 0) {
                  event.preventDefault();
                  setOpen(true);
                  const next =
                    event.key === 'ArrowDown'
                      ? (active + 1) % results.length
                      : active <= 0
                        ? results.length - 1
                        : active - 1;
                  setActiveId((results[next] as CatalogRecord).id);
                } else if (event.key === 'Enter' && expanded && active >= 0) {
                  event.preventDefault();
                  choose(results[active] as CatalogRecord);
                }
              }}
            />
          </div>
        </PopoverAnchor>
        <span id={hintId} className="sr-only">
          {m.catalog_hint()}
        </span>
        {expanded ? (
          <PopoverContent
            role="presentation"
            className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-16px)] p-0"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
            }}
            onInteractOutside={(event) => {
              if ((anchor.current as HTMLDivElement).contains(event.target as Node)) event.preventDefault();
            }}
          >
            <ul
              ref={(node) => {
                // The portal may mount after the input's render, so scroll when its actual list is attached.
                if (node !== null && active >= 0) {
                  (node.children[active] as HTMLElement).scrollIntoView({ block: 'nearest' });
                }
              }}
              id={listId}
              role="listbox"
              aria-label={m.catalog_results()}
              className="max-h-[360px] overflow-y-auto overscroll-contain p-1.5"
            >
              {results.map((record, index) => (
                <li
                  key={record.id}
                  id={`${listId}-${String(index)}`}
                  role="option"
                  aria-selected={index === active}
                  onPointerDown={(event) => {
                    event.preventDefault();
                  }}
                  onPointerMove={() => {
                    setActiveId(record.id);
                  }}
                  onClick={() => {
                    choose(record);
                  }}
                  className={`flex min-h-10 cursor-default items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-[13.5px] ${index === active ? 'bg-surface-4 text-fg' : 'text-text-secondary'}`}
                >
                  {record.logoPath === null ? null : (
                    <img
                      src={record.logoPath}
                      alt=""
                      className="size-7 shrink-0 rounded bg-white object-contain p-0.5"
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    {record.symbol === null ? record.name : `${record.symbol} · ${record.name}`}
                    {record.venue === null ? null : (
                      <span className="block font-mono text-[11.5px] text-subtle">
                        {m.catalog_listing({ venue: record.venue, currency: record.currency as string })}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="border-t border-border px-3 py-2 text-[12px] text-muted-fg">{m.catalog_manual()}</p>
          </PopoverContent>
        ) : hasQuery && results.length === 0 ? (
          <p className="mt-1 text-[12px] text-muted-fg">{m.catalog_manual()}</p>
        ) : null}
      </div>
    </Popover>
  );
}
