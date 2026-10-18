// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FR-A9 in Settings: an action Better Auth refuses with `REAUTHENTICATION_REQUIRED` opens `ReauthDialog`, and runs
 * once more after the user signed in again.
 */
import { useRef, useState, type ReactNode } from 'react';
import type { AuthResult } from '../../lib/auth-client.ts';
import { needsReauthentication } from '../../lib/auth-errors.ts';
import type { Viewer } from '../../server/gate.ts';
import { ReauthDialog } from '../reauth-dialog.tsx';

export type Reauthenticate = () => Promise<boolean>;

/** Runs `action`; when the session is too old, asks `reauthenticate` and runs it again if that succeeded. */
export async function retryAfterReauth<T>(
  action: () => Promise<AuthResult<T>>,
  reauthenticate: Reauthenticate,
): Promise<AuthResult<T>> {
  const result = await action();
  if (result.ok || !needsReauthentication(result.error.code)) return result;
  return (await reauthenticate()) ? action() : result;
}

export interface Reauthentication {
  /** Opens the dialog; resolves `true` once signed in again, `false` when it was closed. */
  reauthenticate: Reauthenticate;
  /** Render it once, anywhere in the section. */
  dialog: ReactNode;
}

export function useReauthentication(viewer: Pick<Viewer, 'email' | 'sessionId'>): Reauthentication {
  const [open, setOpen] = useState(false);
  // Replaced by each `reauthenticate()` call before the dialog can settle; `Boolean` is a harmless no-op until then.
  const settle = useRef<(done: boolean) => unknown>(Boolean);
  const finish = (done: boolean) => {
    settle.current(done);
    setOpen(false);
  };
  const reauthenticate: Reauthenticate = () => {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    settle.current = resolve;
    setOpen(true);
    return promise;
  };
  const dialog = (
    <ReauthDialog
      open={open}
      onOpenChange={() => {
        finish(false);
      }}
      email={viewer.email}
      sessionId={viewer.sessionId}
      onDone={() => {
        finish(true);
      }}
    />
  );
  return { reauthenticate, dialog };
}
