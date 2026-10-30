// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Arsipkan rekening" (FR-R5, design `wkqih`): the account leaves pickers and cards, its transactions stay in
 * reports. A positive balance can first move to another active account of the same currency.
 */
import type { AccountView } from '@wf/db/accounts';
import { m } from '@wf/i18n/messages';
import { Checkbox } from '@wf/ui/checkbox';
import { Money } from '@wf/ui/money';
import { Select } from '@wf/ui/select';
import { toast } from '@wf/ui/toast';
import { Archive, ArrowRight, Wallet } from 'lucide-react';
import { useState } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { archiveAccount } from '../../server/fn/accounts.ts';
import { Button, FormError } from '../form.tsx';
import { Modal } from '../modal.tsx';
import { usePreferences } from '../preferences.tsx';

export interface ArchiveDialogProps {
  readonly account: AccountView;
  /** The user's accounts (the archived one and inactive ones are filtered out here). */
  readonly accounts: readonly AccountView[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onDone: () => void;
}

export function ArchiveDialog({ account, accounts, onOpenChange, onDone }: ArchiveDialogProps) {
  const { preferences } = usePreferences();
  const { locale } = preferences;
  const others = accounts.filter((other) => other.status === 'active' && other.id !== account.id);
  const targets = others.filter((other) => other.currency === account.currency);
  const canMove = account.balanceMinor > 0n && targets.length > 0;
  const [move, setMove] = useState(canMove);
  const [targetId, setTargetId] = useState<string | null>(targets[0]?.id ?? null);
  const [clientId] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const target = targets.find((other) => other.id === targetId);
  const transfer = canMove && move && target !== undefined;

  const submit = async () => {
    setPending(true);
    setFailure(null);
    const result = await archiveAccount({
      data: {
        id: account.id,
        ...(transfer ? { transfer: { toAccountId: target.id, clientId } } : {}),
      },
    });
    setPending(false);
    if (!result.ok) {
      setFailure(ledgerErrorMessage(result.code, locale));
      return;
    }
    toast({ title: m.accounts_archive_done({ name: account.displayName }) });
    onDone();
  };

  return (
    <Modal
      open
      onOpenChange={onOpenChange}
      size="lg"
      title={m.accounts_archive_title({ name: account.displayName })}
      description={m.accounts_archive_description({ count: account.transactionCount })}
    >
      <div className="flex flex-col gap-3">
        {canMove ? (
          <section className="flex flex-col gap-2.5 rounded-[10px] border border-border p-3">
            <p className="flex items-center gap-2 text-[13px] font-medium text-fg">
              <Wallet aria-hidden="true" className="size-3.5 text-muted-fg" />
              {m.accounts_archive_remaining()}{' '}
              <Money minor={account.balanceMinor} currency={account.currency} context="amount" locale={locale} />
            </p>
            <Checkbox
              label={m.accounts_archive_move()}
              description={m.accounts_archive_move_optional()}
              checked={move}
              onChange={(event) => {
                setMove(event.target.checked);
              }}
            />
            {move ? (
              <div className="flex flex-col gap-1.5">
                <Select
                  aria-label={m.accounts_archive_move_to()}
                  size="sm"
                  value={targetId}
                  onValueChange={setTargetId}
                  placeholder={m.accounts_archive_move_to()}
                  options={targets.map((other) => ({ value: other.id, label: other.displayName }))}
                />
              </div>
            ) : null}
            {transfer ? (
              <p className="flex items-center gap-1.5 text-[12px] text-muted-fg">
                <Money minor={target.balanceMinor} currency={target.currency} context="amount" locale={locale} />
                <ArrowRight aria-label={m.accounts_archive_becomes()} className="size-3" />
                <Money
                  minor={target.balanceMinor + account.balanceMinor}
                  currency={target.currency}
                  context="amount"
                  locale={locale}
                  className="text-fg"
                />
              </p>
            ) : null}
          </section>
        ) : null}

        {failure === null ? null : <FormError>{failure}</FormError>}

        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {m.accounts_cancel()}
          </Button>
          <Button size="sm" pending={pending} onClick={() => void submit()}>
            <Archive aria-hidden="true" className="size-3.5" />
            {transfer ? m.accounts_archive_submit_transfer() : m.accounts_archive_submit()}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
