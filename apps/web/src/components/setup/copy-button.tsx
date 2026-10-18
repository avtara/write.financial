// SPDX-License-Identifier: AGPL-3.0-only
import { m } from '@wf/i18n/messages';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

const NOTE: Readonly<Record<'copied' | 'failed', () => string>> = {
  copied: m.setup_copied,
  failed: m.setup_copy_failed,
};

/** Copies `value` to the clipboard; says so (or that it could not, so the text has to be selected by hand). */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<'copied' | 'failed' | null>(null);
  const Icon = state === 'copied' ? Check : Copy;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5">
      <span role="status" className="text-[11.5px] text-subtle">
        {state === null ? null : NOTE[state]()}
      </span>
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          navigator.clipboard.writeText(value).then(
            () => {
              setState('copied');
            },
            () => {
              setState('failed');
            },
          );
        }}
        className="flex size-7 items-center justify-center rounded-[6px] text-muted-fg hover:bg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Icon aria-hidden="true" className="size-3.5" />
      </button>
    </span>
  );
}
