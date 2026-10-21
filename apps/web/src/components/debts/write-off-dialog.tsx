// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Hapuskan" (FR-U7): after this confirmation the remainder of a receivable becomes a "Piutang tak tertagih" expense
 * today (`writeOffReceivable`); balances do not change, net worth drops by it.
 */
import type { ReceivableView } from '@wf/db/receivables';
import type { Locale } from '@wf/i18n/locale';
import { m } from '@wf/i18n/messages';
import { Money } from '@wf/ui/money';
import { useState } from 'react';
import { ledgerErrorMessage } from '../../lib/ledger-errors.ts';
import { writeOffReceivable } from '../../server/fn/receivables.ts';
import { Button, FormError } from '../form.tsx';
import { Modal } from '../modal.tsx';
import { RichMessage } from '../rich-message.tsx';

export interface WriteOffDialogProps {
  /** `null` = closed. */
  readonly receivable: ReceivableView | null;
  readonly onClose: () => void;
  readonly locale: Locale;
  readonly onSaved: (receivable: ReceivableView) => void;
}

export function WriteOffDialog({ receivable, onClose, locale, onSaved }: WriteOffDialogProps) {
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const close = () => {
    setFailure(null);
    setClientId(crypto.randomUUID());
    onClose();
  };
  const confirm = async (target: ReceivableView) => {
    setPending(true);
    setFailure(null);
    const result = await writeOffReceivable({ data: { id: target.id, clientId, occurredAt: new Date() } });
    setPending(false);
    if (!result.ok) {
      setFailure(ledgerErrorMessage(result.code, locale));
      return;
    }
    setClientId(crypto.randomUUID());
    onSaved(result.value);
  };
  return (
    <Modal
      open={receivable !== null}
      onOpenChange={close}
      title={m.receivables_write_off_title({ name: receivable?.counterparty ?? '' })}
      description={
        receivable === null ? undefined : (
          <RichMessage
            message={m.receivables_write_off_description}
            slots={{
              amount: (
                <Money
                  minor={receivable.remainingMinor}
                  currency={receivable.currency}
                  context="amount"
                  locale={locale}
                />
              ),
            }}
          />
        )
      }
    >
      {failure === null ? null : <FormError>{failure}</FormError>}
      {receivable === null ? null : (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>
            {m.receivables_cancel()}
          </Button>
          <Button
            variant="destructive"
            pending={pending}
            onClick={() => {
              void confirm(receivable);
            }}
          >
            {m.receivables_write_off_confirm()}
          </Button>
        </div>
      )}
    </Modal>
  );
}
