// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The app-wide ⌘K actions (FR-S4), mounted once in the `_app` layout inside both providers: "Catat transaksi" (`N`)
 * and "Catat transfer" open the Record Transaction sheet, and a query that matches nothing can be recorded as a
 * transaction's description.
 */
import { m } from '@wf/i18n/messages';
import { ArrowLeftRight, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { useRecordTransaction } from '../ledger/record-transaction.tsx';
import { useCommandActions, type CommandActions } from './command-palette.tsx';

export function AppCommandActions() {
  const { open } = useRecordTransaction();
  const actions = useMemo<CommandActions>(
    () => ({
      quick: [
        {
          id: 'record',
          label: m.cmdk_action_record(),
          icon: Plus,
          shortcut: ['N'],
          run: () => {
            open();
          },
        },
        {
          id: 'record-transfer',
          label: m.cmdk_action_transfer(),
          icon: ArrowLeftRight,
          run: () => {
            open({ type: 'transfer' });
          },
        },
      ],
      create: [
        {
          id: 'record-as',
          icon: Plus,
          label: (query) => m.cmdk_create_transaction({ query }),
          run: (query) => {
            open({ description: query });
          },
        },
      ],
    }),
    [open],
  );
  useCommandActions(actions);
  return null;
}
