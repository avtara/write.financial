// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The 10 one-time backup codes, shown once after 2FA turns on or after "Buat kode baru" (FR-A4): copy all, download
 * as `.txt` (through a `blob:` URL, never `data:`), and continue only after confirming they are saved.
 */
import { m } from '@wf/i18n/messages';
import { Checkbox } from '@wf/ui/checkbox';
import { Check, Copy, Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from './form.tsx';

export const BACKUP_CODES_FILE = 'write-financial-backup-codes.txt';

function download(codes: readonly string[]): void {
  const text = `${m.totp_backup_file_heading()}\n\n${codes.join('\n')}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = BACKUP_CODES_FILE;
  link.click();
  URL.revokeObjectURL(url);
}

export function BackupCodes({ codes, onDone }: { codes: readonly string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted-fg">{m.totp_backup_intro()}</p>
      <ul
        aria-label={m.totp_backup_codes_label()}
        className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-[10px] border border-border bg-surface-sunken px-4 py-3 font-mono text-[13.5px] text-fg"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(codes.join('\n')).then(() => {
              setCopied(true);
            });
          }}
        >
          {copied ? (
            <Check aria-hidden="true" className="size-3.5" />
          ) : (
            <Copy aria-hidden="true" className="size-3.5" />
          )}
          {copied ? m.totp_copied() : m.totp_backup_copy()}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            download(codes);
          }}
        >
          <Download aria-hidden="true" className="size-3.5" />
          {m.totp_backup_download()}
        </Button>
      </div>
      <Checkbox
        label={m.totp_backup_saved()}
        checked={saved}
        onChange={(event) => {
          setSaved(event.target.checked);
        }}
      />
      <div className="flex justify-end">
        <Button size="sm" disabled={!saved} onClick={onDone}>
          {m.totp_done()}
        </Button>
      </div>
    </div>
  );
}
