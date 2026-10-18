// SPDX-License-Identifier: AGPL-3.0-only
import { m } from '@wf/i18n/messages';
import { TriangleAlert } from 'lucide-react';
import { hardNavigate } from '../../lib/navigation.ts';
import { Button } from '../form.tsx';
import { CopyButton } from './copy-button.tsx';

/** Where the self-host `init` keeps the key-encryption key (docs/self-host/install.md §4). */
const KEK_PATH = '/run/wf-secrets/kek';
const BACKUP_COMMANDS = [
  'docker compose cp web:/run/wf-secrets/kek ./write-financial-kek.backup',
  'chmod 600 ./write-financial-kek.backup',
] as const;

/** The end of the wizard: setup is complete; back up the KEK before anything is encrypted with it. */
export function DoneStep() {
  return (
    <div className="flex flex-col gap-[18px]">
      <section
        aria-labelledby="kek-backup-title"
        className="flex flex-col gap-3 rounded-[10px] border border-amber-tint-3 bg-amber-tint-1 p-4"
      >
        <div className="flex items-start gap-2.5">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-fg" />
          <div className="flex flex-col gap-1">
            <h2 id="kek-backup-title" className="text-[13px] font-semibold text-fg">
              {m.setup_kek_title()}
            </h2>
            <p className="text-[12.5px] text-text-secondary">{m.setup_kek_warning()}</p>
          </div>
        </div>
        <p className="text-[12.5px] text-text-secondary">{m.setup_kek_location({ path: KEK_PATH })}</p>
        <ul className="flex flex-col gap-1.5">
          {BACKUP_COMMANDS.map((command) => (
            <li
              key={command}
              className="flex items-center gap-2 rounded-[8px] border border-border bg-surface-sunken py-1 pr-1 pl-3"
            >
              <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[11.5px] whitespace-nowrap text-fg">
                {command}
              </code>
              <CopyButton value={command} label={m.setup_copy_command({ command })} />
            </li>
          ))}
        </ul>
        <p className="text-[12px] text-muted-fg">{m.setup_kek_store()}</p>
      </section>
      <Button
        className="w-full"
        onClick={() => {
          hardNavigate('/');
        }}
      >
        {m.setup_done_action()}
      </Button>
    </div>
  );
}
