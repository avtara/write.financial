// SPDX-License-Identifier: AGPL-3.0-only
/**
 * "Keluar dari write.financial?" (design `LpVa1`, FR-A5): optionally signs every other device out first, then this
 * one, and loads the sign-in page from scratch so nothing of the account stays in memory. Built on Radix AlertDialog
 * like `ConfirmDialog`, which has no room for the "all devices" option.
 */
import { m } from '@wf/i18n/messages';
import { LogOut } from 'lucide-react';
import { AlertDialog } from 'radix-ui';
import { useEffect, useRef, useState } from 'react';
import { authErrorMessage } from '../lib/auth-errors.ts';
import { hardNavigate } from '../lib/navigation.ts';
import type { DeviceView } from '../server/account.ts';
import { listDevices, revokeOtherDevices } from '../server/fn/account.ts';
import { useAuthActions } from './auth-actions.tsx';
import { Button, Checkbox, FormError } from './form.tsx';
import { usePreferences } from './preferences.tsx';

function SignOutForm() {
  const actions = useAuthActions();
  const { preferences } = usePreferences();
  const [others, setOthers] = useState<readonly DeviceView[]>([]);
  const [everywhere, setEverywhere] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void listDevices().then((result) => {
      if (current && result.ok) setOthers(result.value.filter((device) => !device.current));
    });
    return () => {
      current = false;
    };
  }, []);

  const signOut = async (): Promise<void> => {
    setPending(true);
    setError(null);
    if (everywhere) await revokeOtherDevices();
    const result = await actions.signOut();
    if (result.ok) {
      hardNavigate('/sign-in');
      return;
    }
    setPending(false);
    setError(authErrorMessage(result.error, preferences.locale));
  };

  return (
    <>
      {others.length === 0 ? null : (
        <div className="rounded-[9px] border border-border bg-surface-sunken px-3 py-2.5">
          <Checkbox
            label={m.signout_everywhere()}
            description={m.signout_other_devices({
              count: others.length,
              labels: others.map((device) => device.label ?? m.device_unknown()).join(', '),
            })}
            checked={everywhere}
            onChange={(event) => {
              setEverywhere(event.target.checked);
            }}
          />
        </div>
      )}
      {error === null ? null : <FormError>{error}</FormError>}
      <div className="mt-1 flex justify-end gap-2">
        <AlertDialog.Cancel asChild>
          <Button variant="secondary" size="sm">
            {m.signout_cancel()}
          </Button>
        </AlertDialog.Cancel>
        <Button
          variant="destructive"
          size="sm"
          pending={pending}
          onClick={() => {
            void signOut();
          }}
        >
          {m.signout_confirm()}
        </Button>
      </div>
    </>
  );
}

export function SignOutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const opener = useRef<HTMLElement | null>(null);
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <AlertDialog.Content
          onOpenAutoFocus={() => {
            opener.current = document.activeElement as HTMLElement | null;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
          className="fixed top-1/2 left-1/2 z-50 flex w-[420px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-[14px] border border-border-dialog bg-dialog p-6 text-fg shadow-[0_16px_48px_var(--shadow)]"
        >
          <span className="flex size-9 items-center justify-center rounded-[9px] bg-red-tint-2 text-red-fg">
            <LogOut aria-hidden="true" className="size-[18px]" />
          </span>
          <div className="flex flex-col gap-1.5">
            <AlertDialog.Title className="text-[16px] font-semibold">{m.signout_title()}</AlertDialog.Title>
            <AlertDialog.Description className="text-[13px] text-muted-fg">
              {m.signout_description()}
            </AlertDialog.Description>
          </div>
          <SignOutForm />
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
