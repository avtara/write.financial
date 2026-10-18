// SPDX-License-Identifier: AGPL-3.0-only
import type { Config } from '@wf/config';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { S3BatchDeleteError, createS3Port } from './s3.ts';

const ENDPOINT = 'http://s3.test:8333';
const s3: Config['s3'] = {
  endpoint: ENDPOINT,
  region: 'us-east-1',
  accessKeyId: 'test-access-key',
  secretAccessKey: ['test', 'secret'].join('-'),
  buckets: { attachments: 'wf-attachments', avatars: 'wf-avatars', reports: 'wf-reports', exports: 'wf-exports' },
};
const KEY = 'u/0192f0c1-7c1e-7000-8000-000000000001/0192f0c1-7c1e-7000-8000-0000000000aa';

interface Recorded {
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
  readonly body: Uint8Array;
}

const xml = (body: string, status = 200) =>
  new HttpResponse(`<?xml version="1.0" encoding="UTF-8"?>${body}`, {
    status,
    headers: { 'Content-Type': 'application/xml' },
  });

let requests: Recorded[];
let respond: (request: Recorded) => Response;

const server = setupServer(
  http.all(`${ENDPOINT}/*`, async ({ request }) => {
    const recorded = {
      method: request.method,
      url: new URL(request.url),
      headers: request.headers,
      body: new Uint8Array(await request.arrayBuffer()),
    };
    requests.push(recorded);
    return respond(recorded);
  }),
);

beforeAll(() => {
  server.listen({ onUnhandledFrame: 'error' });
});
afterAll(() => {
  server.close();
});
beforeEach(() => {
  requests = [];
});
afterEach(() => {
  server.resetHandlers();
});

const port = createS3Port(s3);

describe('createS3Port', () => {
  it('puts the body path-style, signed, as opaque octets, without optional checksum headers', async () => {
    respond = () => new HttpResponse(null, { status: 200, headers: { ETag: '"x"' } });
    await port.putObject('wf-attachments', KEY, Uint8Array.of(1, 2, 3));

    const [request] = requests;
    expect(request?.method).toBe('PUT');
    expect(`${request?.url.origin}${request?.url.pathname}`).toBe(`${ENDPOINT}/wf-attachments/${KEY}`);
    expect(request?.body).toEqual(Uint8Array.of(1, 2, 3));
    expect(request?.headers.get('content-type')).toBe('application/octet-stream');
    expect(request?.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=test-access-key\//);
    expect([...(request?.headers.keys() ?? [])].filter((name) => name.startsWith('x-amz-checksum'))).toEqual([]);
  });

  it('gets the object bytes', async () => {
    respond = () => new HttpResponse(Uint8Array.of(9, 8, 7), { status: 200 });
    await expect(port.getObject('wf-attachments', KEY)).resolves.toEqual(Uint8Array.of(9, 8, 7));
    expect(requests[0]?.method).toBe('GET');
    expect(requests[0]?.url.pathname).toBe(`/wf-attachments/${KEY}`);
  });

  it('returns null for NoSuchKey', async () => {
    respond = () =>
      xml('<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>', 404);
    await expect(port.getObject('wf-attachments', KEY)).resolves.toBeNull();
  });

  it('rethrows every other S3 error', async () => {
    respond = () => xml('<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>', 403);
    await expect(port.getObject('wf-attachments', KEY)).rejects.toMatchObject({ name: 'AccessDenied' });
  });

  it('deletes one object', async () => {
    respond = () => new HttpResponse(null, { status: 204 });
    await port.deleteObject('wf-avatars', KEY);
    expect(requests.map(({ method, url }) => `${method} ${url.pathname}`)).toEqual([`DELETE /wf-avatars/${KEY}`]);
  });

  it('lists one page of keys under a prefix and passes the continuation token', async () => {
    respond = () =>
      xml(
        '<ListBucketResult><Name>wf-attachments</Name><IsTruncated>true</IsTruncated>' +
          '<NextContinuationToken>page-3</NextContinuationToken>' +
          '<Contents><Key>u/a/1</Key><Size>10</Size></Contents><Contents><Key>u/a/2</Key><Size>20</Size></Contents>' +
          '</ListBucketResult>',
      );
    await expect(port.listObjects('wf-attachments', 'u/a/', 'page-2')).resolves.toEqual({
      keys: ['u/a/1', 'u/a/2'],
      nextToken: 'page-3',
    });
    const query = Object.fromEntries(requests[0]?.url.searchParams ?? []);
    expect(query).toEqual({ 'list-type': '2', prefix: 'u/a/', 'max-keys': '1000', 'continuation-token': 'page-2' });
  });

  it('lists an empty prefix as no keys and no next page', async () => {
    respond = () =>
      xml('<ListBucketResult><Name>wf-attachments</Name><IsTruncated>false</IsTruncated></ListBucketResult>');
    await expect(port.listObjects('wf-attachments', 'u/b/')).resolves.toEqual({ keys: [], nextToken: undefined });
    expect(requests[0]?.url.searchParams.has('continuation-token')).toBe(false);
  });

  it('batch-deletes keys quietly', async () => {
    respond = () => xml('<DeleteResult></DeleteResult>');
    await port.deleteObjects('wf-attachments', ['u/a/1', 'u/a/2']);

    const [request] = requests;
    expect(request?.method).toBe('POST');
    expect(request?.url.searchParams.has('delete')).toBe(true);
    const body = new TextDecoder().decode(request?.body);
    expect(body).toContain('<Object><Key>u/a/1</Key></Object><Object><Key>u/a/2</Key></Object>');
    expect(body).toContain('<Quiet>true</Quiet>');
  });

  it('throws S3BatchDeleteError listing the keys S3 failed to delete', async () => {
    respond = () =>
      xml(
        '<DeleteResult><Error><Key>u/a/2</Key><Code>AccessDenied</Code><Message>Access Denied</Message></Error>' +
          '</DeleteResult>',
      );
    const error = await port.deleteObjects('wf-attachments', ['u/a/1', 'u/a/2']).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(S3BatchDeleteError);
    expect(error).toMatchObject({ name: 'S3BatchDeleteError', keys: ['u/a/2'] });
    expect((error as Error).message).toBe('S3 failed to delete 1 object(s): u/a/2');
  });
});
