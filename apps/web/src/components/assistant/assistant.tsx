// SPDX-License-Identifier: AGPL-3.0-only
/**
 * FR-AI3: the Assistant's entry point, `⌘J` from any signed-in page (and the ⌘K "Tanya Asisten" action). The sheet
 * itself lives in {@link AssistantDialog}; this provider only owns whether it is open, so a page can open it without
 * knowing its internals.
 */
import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react';
import { useShortcuts } from '../shortcuts.tsx';
import { AssistantDialog } from './assistant-dialog.tsx';

export interface AssistantApi {
  readonly open: () => void;
  readonly close: () => void;
  readonly isOpen: boolean;
}

/** Thrown when `useAssistant` is used outside `<AssistantProvider>`. */
export class MissingAssistantProviderError extends Error {
  override name = 'MissingAssistantProviderError';
}

const AssistantContext = createContext<AssistantApi | null>(null);

export function useAssistant(): AssistantApi {
  const api = use(AssistantContext);
  if (api === null) throw new MissingAssistantProviderError('useAssistant() needs its provider');
  return api;
}

/** `⌘J` / `Ctrl+J`, the design's shortcut for the Assistant. */
export const ASSISTANT_KEYS = ['mod', 'j'] as const;
/** How `ASSISTANT_KEYS` reads in a hint (`⌘J`). */
export const ASSISTANT_HINT = ['mod', 'J'] as const;

export function AssistantProvider({ timeZone, children }: { readonly timeZone: string; readonly children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => {
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  const api = useMemo<AssistantApi>(() => ({ open: show, close, isOpen: open }), [show, close, open]);
  const shortcuts = useMemo(() => [{ keys: [...ASSISTANT_KEYS], run: show }], [show]);
  useShortcuts(shortcuts);
  return (
    <AssistantContext value={api}>
      {children}
      <AssistantDialog open={open} onClose={close} timeZone={timeZone} />
    </AssistantContext>
  );
}
