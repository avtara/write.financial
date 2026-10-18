// SPDX-License-Identifier: AGPL-3.0-only
import type { S3Port } from '@wf/s3';

/** Every key in `bucket`, fetched one page at a time as the caller iterates. */
export async function* listKeys(s3: S3Port, bucket: string): AsyncGenerator<string, void, undefined> {
  let token: string | undefined;
  do {
    const page = await s3.listObjects(bucket, '', token);
    yield* page.keys;
    token = page.nextToken;
  } while (token !== undefined);
}
