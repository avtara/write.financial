// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { FakeS3 } from '../test/fake-s3.ts';
import { listKeys } from './storage.ts';

describe('listKeys', () => {
  it('lists every key of a bucket page by page, fetching a page only when the caller gets there', async () => {
    const s3 = new FakeS3(['wf-attachments'], 2);
    for (const key of ['u/a/1', 'u/a/2', 'u/b/3']) await s3.putObject('wf-attachments', key, new Uint8Array(1));
    s3.calls.length = 0;

    const keys = listKeys(s3, 'wf-attachments');
    expect((await keys.next()).value).toBe('u/a/1');
    expect(s3.calls).toEqual(['list wf-attachments/ -']);
    const rest: string[] = [];
    for await (const key of keys) rest.push(key);
    expect(rest).toEqual(['u/a/2', 'u/b/3']);
    expect(s3.calls).toEqual(['list wf-attachments/ -', 'list wf-attachments/ 2']);
  });

  it('lists nothing in an empty bucket', async () => {
    const keys: string[] = [];
    for await (const key of listKeys(new FakeS3(['wf-exports']), 'wf-exports')) keys.push(key);
    expect(keys).toEqual([]);
  });
});
