// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Deteksi dari transaksi" (FR-SUB4, design `DIcp7`): recurring charges found in the user's transactions that are not
 * tracked yet ("Vidio · tiap ±tgl 12 · terakhir 12 Okt", the months it was charged), each with "Tambahkan" and
 * "Bukan langganan", and "Tambah semua" with what the monthly total would become ("Jika ditambahkan: Rp970.800/bulan
 * (+Rp65.900)"). Detection starts once two months of transactions exist.
 *
 * The panel has no trigger of its own: the page opens it from a secondary header action (folded into ⋯ below 1024 px,
 * FR-TB3) labelled by `detectionLabel`, and it hangs off `children`, the header's action row.
 */
import type { AccountView } from '@wf/db/accounts';
import type { CategoryView } from '@wf/db/categories';
import type { DetectedOverview, DetectedView } from '@wf/db/schedules';
import { DETECTION_MIN_MONTHS } from '@wf/domain/subscriptions';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/ui/dates';
import { Money } from '@wf/ui/money';
import { Popover, PopoverAnchor, PopoverContent } from '@wf/ui/popover';
import { Check, Plus, ScanSearch } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { categoryName } from '../../lib/ledger-labels.ts';
import { Button } from '../form.tsx';
import { RichMessage } from '../rich-message.tsx';
import { SubscriptionAvatar } from './subscription-avatar.tsx';

export interface DetectionPanelProps {
  readonly detected: DetectedOverview | null;
  readonly baseCurrency: string;
  readonly accounts: readonly AccountView[];
  readonly categories: readonly CategoryView[];
  readonly locale: Locale;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onAdd: (ids: readonly string[]) => Promise<void>;
  readonly onDismiss: (ids: readonly string[]) => Promise<void>;
  /** What the panel hangs off (the header's action row). */
  readonly children: ReactNode;
}

/** "Deteksi dari transaksi", plus "· 2 baru" while candidates wait. */
export function detectionLabel(detected: DetectedOverview | null): string {
  const count = detected?.candidates.length ?? 0;
  return count === 0
    ? m.subscriptions_detect_button()
    : `${m.subscriptions_detect_button()} · ${m.subscriptions_detect_new({ count })}`;
}

/** The months a candidate was charged in, oldest first, ending with the month of its latest charge. */
function chargedMonths(candidate: DetectedView, locale: Locale): string[] {
  const year = Number(candidate.lastSeenOn.slice(0, 4));
  const month = Number(candidate.lastSeenOn.slice(5, 7)) - 1;
  return Array.from({ length: candidate.occurrences }, (_, index) =>
    new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(
      new Date(Date.UTC(year, month - (candidate.occurrences - 1 - index), 1)),
    ),
  );
}

export function DetectionPanel({
  detected,
  baseCurrency,
  accounts,
  categories,
  locale,
  open,
  onOpenChange,
  onAdd,
  onDismiss,
  children,
}: DetectionPanelProps) {
  const [pending, setPending] = useState<string | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const candidates = detected?.candidates ?? [];
  const run = async (key: string, action: Promise<void>) => {
    setPending(key);
    await action;
    setPending(null);
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor ref={anchor} className="flex flex-wrap items-center gap-2">
        {children}
      </PopoverAnchor>
      <PopoverContent
        align="end"
        className="w-[440px] max-w-[calc(100vw-32px)] p-0"
        // Opened from further down the page ("Tinjau" in "Bisa dihemat"), the header it hangs off is scrolled away.
        onOpenAutoFocus={() => {
          (anchor.current as HTMLDivElement).scrollIntoView({ block: 'nearest' });
        }}
      >
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <ScanSearch aria-hidden="true" className="size-4 text-muted-fg" />
          <h2 className="text-[13.5px] font-semibold text-fg">
            {candidates.length === 0
              ? m.subscriptions_detect_none()
              : m.subscriptions_detect_title({ count: candidates.length })}
          </h2>
        </header>
        {candidates.length === 0 ? (
          <p className="px-4 py-4 text-[12.5px] text-subtle">
            {m.subscriptions_detect_none_hint({ months: DETECTION_MIN_MONTHS })}
          </p>
        ) : (
          <ul className="flex max-h-[420px] flex-col overflow-y-auto">
            {candidates.map((candidate) => {
              const account = accounts.find((candidateAccount) => candidateAccount.id === candidate.accountId);
              const category = categories.find((candidateCategory) => candidateCategory.id === candidate.categoryId);
              return (
                <li
                  key={candidate.id}
                  className="flex flex-col gap-2.5 border-b border-border px-4 py-3 last:border-b-0"
                >
                  <div className="flex items-start gap-3">
                    <SubscriptionAvatar
                      subscription={{ id: candidate.id, name: candidate.merchant, icon: null, logoKey: null }}
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-[13px] font-medium text-fg">{candidate.merchant}</span>
                      <span className="text-[11.5px] text-subtle">
                        {m.subscriptions_detect_pattern({
                          day: candidate.dayOfMonth,
                          date: formatDate(candidate.lastSeenOn, locale, 'day'),
                        })}
                      </span>
                    </div>
                    <Money
                      minor={candidate.amountMinor}
                      currency={candidate.currency}
                      context="amount"
                      locale={locale}
                      className="text-[13px] text-fg"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 pl-11 text-[11px] text-muted-fg">
                    {chargedMonths(candidate, locale).map((month) => (
                      <span key={month} className="inline-flex items-center gap-0.5 rounded-[4px] bg-tint-06 px-1.5">
                        <Check aria-hidden="true" className="size-3 text-green-fg" />
                        {month}
                      </span>
                    ))}
                    <span>
                      {[account?.displayName, category === undefined ? undefined : categoryName(category)]
                        .filter((part) => part !== undefined)
                        .join(' · ')}
                    </span>
                  </div>
                  <div className="flex gap-2 pl-11">
                    <Button
                      size="sm"
                      pending={pending === candidate.id}
                      onClick={() => void run(candidate.id, onAdd([candidate.id]))}
                    >
                      <Plus aria-hidden="true" className="size-3.5" />
                      {m.subscriptions_detect_add()}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      pending={pending === `dismiss-${candidate.id}`}
                      onClick={() => void run(`dismiss-${candidate.id}`, onDismiss([candidate.id]))}
                    >
                      {m.subscriptions_detect_dismiss()}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {detected === null || candidates.length === 0 ? null : (
          <footer className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
            <span className="font-mono text-[11.5px] text-muted-fg">
              <RichMessage
                message={m.subscriptions_detect_impact}
                slots={{
                  total: (
                    <Money
                      minor={detected.impact.totalMinor}
                      currency={baseCurrency}
                      context="amount"
                      locale={locale}
                    />
                  ),
                  added: (
                    <Money
                      minor={detected.impact.addedMinor}
                      currency={baseCurrency}
                      context="amount"
                      locale={locale}
                    />
                  ),
                }}
              />
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="whitespace-nowrap"
              pending={pending === 'all'}
              onClick={() => void run('all', onAdd(candidates.map((candidate) => candidate.id)))}
            >
              {m.subscriptions_detect_add_all()}
            </Button>
          </footer>
        )}
      </PopoverContent>
    </Popover>
  );
}
