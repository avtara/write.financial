// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings › Data (FR-A11, FR-ST5): "Ekspor semua data" as JSON or CSV downloads, and the delete-account card with
 * its 7-day grace period. Deleting asks for an explicit, typed consent (the account's email — not a word that is
 * easy to copy), then `requestAccountDeletion` starts the grace period; while it runs the card shows the deletion
 * date and "Batalkan penghapusan" instead. Both actions require 2FA (FR-A9): a refusal surfaces as the standard
 * error row.
 */
import { m } from '@wf/i18n/messages';
import { formatDate } from '@wf/i18n/format';
import { TriangleAlert } from 'lucide-react';
import { AlertDialog } from 'radix-ui';
import { useState } from 'react';
import { authErrorMessage } from '../../lib/auth-errors.ts';
import type { DataSettings } from '../../server/fn/data.ts';
import { cancelAccountDeletion, requestAccountDeletion } from '../../server/fn/data.ts';
import { Button, FormError } from '../form.tsx';
import { usePreferences } from '../preferences.tsx';
import { SettingsGroup, SettingsRow } from './settings-ui.tsx';

const DOWNLOAD_JSON = '/api/data/export?format=json';
const DOWNLOAD_CSV = '/api/data/export?format=csv';

function DeleteDialog({
  open,
  onOpenChange,
  email,
  onRequested,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  onRequested: (settings: DataSettings) => void;
}) {
  const { preferences } = usePreferences();
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = confirm === email;

  const request = async (): Promise<void> => {
    setPending(true);
    setError(null);
    const result = await requestAccountDeletion();
    if (result.ok) {
      onRequested(result.value);
      onOpenChange(false);
      return;
    }
    setPending(false);
    setError(authErrorMessage({ code: result.code }, preferences.locale));
  };

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <AlertDialog.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            setConfirm('');
          }}
          className="fixed top-1/2 left-1/2 z-50 flex w-[400px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-[8px] border border-border-dialog bg-dialog p-5 text-fg shadow-[0_16px_48px_var(--shadow)]"
        >
          <AlertDialog.Title className="text-[15px] font-semibold">{m.data_delete_confirm_title()}</AlertDialog.Title>
          <AlertDialog.Description asChild>
            <div className="flex flex-col gap-3">
              <p className="text-[13px] text-muted-fg">{m.data_delete_description()}</p>
              <label className="flex flex-col gap-1">
                <span className="text-[12.5px] text-fg">{m.data_delete_confirm_label({ email })}</span>
                <input
                  type="text"
                  value={confirm}
                  autoComplete="off"
                  onChange={(event) => {
                    setConfirm(event.target.value);
                  }}
                  className="h-9 rounded-[7px] border border-border-input bg-surface-sunken px-2.5 text-[13px] text-fg focus-visible:outline-2 focus-visible:outline-ring"
                />
              </label>
              {error === null ? null : <FormError>{error}</FormError>}
            </div>
          </AlertDialog.Description>
          <div className="mt-2 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary" size="sm">
                {m.data_delete_cancel()}
              </Button>
            </AlertDialog.Cancel>
            <Button variant="destructive" size="sm" pending={pending} disabled={!ready} onClick={() => void request()}>
              {m.data_delete_confirm_button()}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function DataSection({
  email,
  settings,
  timeZone,
}: {
  email: string;
  settings: DataSettings;
  timeZone: string;
}) {
  const { preferences } = usePreferences();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(settings);

  const cancel = async (): Promise<void> => {
    setPendingAction(true);
    setError(null);
    const result = await cancelAccountDeletion();
    if (result.ok) {
      setCurrent(result.value);
      setPendingAction(false);
      return;
    }
    setPendingAction(false);
    setError(authErrorMessage({ code: result.code }, preferences.locale));
  };

  return (
    <div className="flex flex-col gap-5">
      <SettingsGroup label={m.data_export_title()}>
        <SettingsRow title={m.data_export_json()} description={m.data_export_description()}>
          <a
            href={DOWNLOAD_JSON}
            className="inline-flex h-8 items-center justify-center rounded-[6px] border border-border px-3 text-[13px] font-medium text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            {m.data_export_button()}
          </a>
        </SettingsRow>
        <SettingsRow title={m.data_export_csv()} description={m.data_export_csv_description()}>
          <a
            href={DOWNLOAD_CSV}
            className="inline-flex h-8 items-center justify-center rounded-[6px] border border-border px-3 text-[13px] font-medium text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
          >
            {m.data_export_button()}
          </a>
        </SettingsRow>
      </SettingsGroup>

      {current.deletionRequestedAt === null ? (
        <SettingsGroup label={m.data_delete_title()}>
          <SettingsRow title={m.data_delete_title()} description={m.data_delete_description()}>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setDialogOpen(true);
              }}
            >
              {m.data_delete_button()}
            </Button>
          </SettingsRow>
        </SettingsGroup>
      ) : (
        <div className="flex flex-col gap-2">
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-[9px] border border-red-tint-3 bg-red-tint-1 px-3.5 py-3"
          >
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-red-fg" />
            <div className="flex flex-1 flex-col gap-0.5">
              <span className="text-[13px] font-medium text-fg">{m.data_delete_pending_title()}</span>
              <span className="text-[12px] text-muted-fg">
                {m.data_delete_pending({
                  date: formatDate(new Date(current.deleteAfter ?? ''), preferences.locale, { timeZone }),
                })}
              </span>
            </div>
            <Button variant="secondary" size="sm" pending={pendingAction} onClick={() => void cancel()}>
              {m.data_delete_cancel_pending()}
            </Button>
          </div>
          {error === null ? null : <FormError>{error}</FormError>}
        </div>
      )}

      <DeleteDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        email={email}
        onRequested={(requested) => {
          setCurrent(requested);
        }}
      />
    </div>
  );
}
