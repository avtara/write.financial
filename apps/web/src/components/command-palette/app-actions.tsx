// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The app-wide ⌘K actions (FR-S4), mounted once in the `_app` layout inside both providers: "Catat transaksi" (`N`)
 * and "Catat transfer" open the Record Transaction sheet, "Tambah rekening" opens the account form, and a query
 * that matches nothing can be recorded as a transaction's description.
 */
import { useNavigate } from '@tanstack/react-router';
import { m } from '@wf/i18n/messages';
import { ArrowLeftRight, Plus, Wallet } from 'lucide-react';
import { useMemo } from 'react';
import { useRecordTransaction } from '../ledger/record-transaction.tsx';
import { useCommandActions, type CommandActions } from './command-palette.tsx';

export function AppCommandActions() {
  const { open } = useRecordTransaction();
  const navigate = useNavigate();
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
        {
          id: 'add-account',
          label: m.cmdk_create_account(),
          icon: Wallet,
          keywords: [m.cmdk_group_accounts()],
          run: () => {
            void navigate({ to: '/accounts', search: { new: 'bank' } });
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
    [open, navigate],
  );
  useCommandActions(actions);
  return null;
}
