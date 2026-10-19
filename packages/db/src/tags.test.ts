// SPDX-License-Identifier: AGPL-3.0-only
import { randomUUID } from 'node:crypto';
import { DESIGN_SEED } from '@wf/domain/seed';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { insertUser, pgError, PGLITE_HOOK_TIMEOUT, startMigrated, type TestDatabase } from '../test/pglite.ts';
import { createActivity } from './activity.ts';
import { createTags, type TagsRepository } from './tags.ts';

let test: TestDatabase;
let tags: TagsRepository;
let alice: string;
let bob: string;
let account: string;

const asApp = <T>(fn: () => Promise<T>) => test.as('wf_app', fn);

beforeAll(async () => {
  test = await startMigrated();
  tags = createTags(test.db);
}, PGLITE_HOOK_TIMEOUT);

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.query('DELETE FROM users');
  alice = await insertUser(test, 'alice@example.test');
  bob = await insertUser(test, 'bob@example.test');
  const bca = DESIGN_SEED.accounts[0];
  const [row] = await test.query<{ id: string }>(
    `INSERT INTO accounts (user_id, type, provider_name, display_name, currency, opening_date, color)
     VALUES ($1, 'bank', $2, $3, 'IDR', '2026-09-30', 'blue') RETURNING id`,
    [alice, bca?.providerName, bca?.displayName],
  );
  account = row?.id ?? '';
});

/** A bare transaction of Alice's (as the superuser) carrying `tagIds`; `deleted` soft-deletes it. */
async function transactionWith(tagIds: readonly string[], deleted = false): Promise<string> {
  const [row] = await test.query<{ id: string }>(
    `INSERT INTO transactions (user_id, type, occurred_at, local_date, client_id, confirmed_by_user_at, deleted_at)
     VALUES ($1, 'expense', now(), '2026-10-15', $2, now(), $3) RETURNING id`,
    [alice, randomUUID(), deleted ? new Date() : null],
  );
  const id = row?.id ?? '';
  await test.query(
    `INSERT INTO postings (user_id, transaction_id, account_id, amount_minor, currency, amount_base_minor)
     VALUES ($1, $2, $3, -45000, 'IDR', -45000)`,
    [alice, id, account],
  );
  for (const tagId of tagIds) {
    await test.query('INSERT INTO transaction_tags (user_id, transaction_id, tag_id) VALUES ($1, $2, $3)', [
      alice,
      id,
      tagId,
    ]);
  }
  return id;
}

const tagsOf = async (transactionId: string) =>
  (
    await test.query<{ slug: string }>(
      'SELECT t.slug FROM transaction_tags tt JOIN tags t ON t.id = tt.tag_id WHERE tt.transaction_id = $1 ORDER BY 1',
      [transactionId],
    )
  ).map((row) => row.slug);

describe('create', () => {
  it('normalizes input and returns an existing tag instead of a second one', async () => {
    const created = await asApp(() => tags.create(alice, '#Dana Darurat'));
    expect(created).toEqual({ id: created.id, slug: 'dana-darurat', usageCount: 0, aliases: [] });
    expect(await asApp(() => tags.create(alice, 'dana-darurat'))).toEqual(created);
    await expect(asApp(() => tags.create(alice, '#!'))).rejects.toMatchObject({ code: 'INVALID_TAG' });
  });
});

describe('list', () => {
  it('orders by usage of non-deleted transactions, then slug, and filters by slug or alias', async () => {
    const kopi = await asApp(() => tags.create(alice, 'kopi'));
    const kerja = await asApp(() => tags.create(alice, 'kerja'));
    const bali = await asApp(() => tags.create(alice, 'liburan-bali'));
    const old = await asApp(() => tags.create(alice, 'ngopi'));
    await transactionWith([kopi.id, kerja.id]);
    await transactionWith([kopi.id]);
    await transactionWith([kerja.id], true);
    await transactionWith([bali.id]);
    await asApp(() => tags.merge(alice, old.id, kopi.id));

    expect(await asApp(() => tags.list(alice))).toEqual([
      { id: kopi.id, slug: 'kopi', usageCount: 2, aliases: ['ngopi'] },
      { id: kerja.id, slug: 'kerja', usageCount: 1, aliases: [] },
      { id: bali.id, slug: 'liburan-bali', usageCount: 1, aliases: [] },
    ]);
    const slugs = async (query: string) => (await asApp(() => tags.list(alice, { query }))).map((tag) => tag.slug);
    expect(await slugs('#Ker')).toEqual(['kerja']);
    expect(await slugs('bali')).toEqual(['liburan-bali']);
    expect(await slugs('ngo')).toEqual(['kopi']);
    expect(await slugs('#')).toEqual(['kopi', 'kerja', 'liburan-bali']);
    expect(await slugs('zzz')).toEqual([]);
    expect(await asApp(() => tags.list(bob))).toEqual([]);
  });
});

describe('rename', () => {
  it('changes the slug, keeps the id, and logs it', async () => {
    const tag = await asApp(() => tags.create(alice, 'kopi'));
    expect(await asApp(() => tags.rename(alice, tag.id, 'Kopi'))).toEqual(tag);
    expect(await asApp(() => tags.rename(alice, tag.id, '#Ngopi Pagi'))).toEqual({ ...tag, slug: 'ngopi-pagi' });
    expect(await asApp(() => createActivity(test.db).list(alice, 'tag', tag.id))).toMatchObject([
      { action: 'updated', meta: { fields: ['slug'] } },
    ]);
  });

  it('refuses slugs used by another tag or its alias, and invalid input', async () => {
    const kopi = await asApp(() => tags.create(alice, 'kopi'));
    const teh = await asApp(() => tags.create(alice, 'teh'));
    const old = await asApp(() => tags.create(alice, 'ngeteh'));
    await asApp(() => tags.merge(alice, old.id, teh.id));
    await expect(asApp(() => tags.rename(alice, kopi.id, 'teh'))).rejects.toMatchObject({ code: 'INVALID_TAG' });
    await expect(asApp(() => tags.rename(alice, kopi.id, 'ngeteh'))).rejects.toMatchObject({ code: 'INVALID_TAG' });
    await expect(asApp(() => tags.rename(alice, kopi.id, '…'))).rejects.toMatchObject({ code: 'INVALID_TAG' });
    await expect(asApp(() => tags.rename(bob, kopi.id, 'kopi-2'))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('drops its own alias when renamed back to a former slug', async () => {
    const teh = await asApp(() => tags.create(alice, 'teh'));
    const old = await asApp(() => tags.create(alice, 'ngeteh'));
    await asApp(() => tags.merge(alice, old.id, teh.id));
    expect(await asApp(() => tags.rename(alice, teh.id, 'ngeteh'))).toEqual({
      id: teh.id,
      slug: 'ngeteh',
      usageCount: 0,
      aliases: [],
    });
  });
});

describe('merge', () => {
  it('moves transactions, goals and aliases, and makes the source slug an alias of the target', async () => {
    const source = await asApp(() => tags.create(alice, 'dana-darurat'));
    const target = await asApp(() => tags.create(alice, 'darurat'));
    const older = await asApp(() => tags.create(alice, 'emergency'));
    await asApp(() => tags.merge(alice, older.id, source.id));
    const others = [];
    for (const slug of ['a1', 'a2', 'a3']) others.push(await asApp(() => tags.create(alice, slug)));
    const onlySource = await transactionWith([source.id]);
    const both = await transactionWith([source.id, target.id]);
    // Full (five tags): moving by UPDATE never trips the five-tags trigger.
    const full = await transactionWith([source.id, ...others.map((tag) => tag.id), target.id]);
    const [goal] = await test.query<{ id: string }>(
      `INSERT INTO goals (user_id, name, icon, color, target_minor, currency, tag_id)
       VALUES ($1, 'Dana Darurat', 'shield', 'green', 54000000, 'IDR', $2) RETURNING id`,
      [alice, source.id],
    );

    const merged = await asApp(() => tags.merge(alice, source.id, target.id));
    expect(merged).toEqual({ id: target.id, slug: 'darurat', usageCount: 3, aliases: ['dana-darurat', 'emergency'] });
    expect(await tagsOf(onlySource)).toEqual(['darurat']);
    expect(await tagsOf(both)).toEqual(['darurat']);
    expect(await tagsOf(full)).toEqual(['a1', 'a2', 'a3', 'darurat']);
    expect(await test.query('SELECT tag_id FROM goals WHERE id = $1', [goal?.id])).toEqual([{ tag_id: target.id }]);
    expect(await test.query('SELECT 1 FROM tags WHERE id = $1', [source.id])).toEqual([]);
    // Old input keeps resolving to the target.
    expect((await asApp(() => tags.create(alice, '#Dana Darurat'))).id).toBe(target.id);
    expect(await asApp(() => createActivity(test.db).list(alice, 'tag', target.id))).toMatchObject([
      { action: 'merged', meta: { from: source.id } },
    ]);
  });

  it('refuses merging a tag into itself or with tags it cannot see', async () => {
    const tag = await asApp(() => tags.create(alice, 'kopi'));
    const bobs = await asApp(() => tags.create(bob, 'kopi'));
    await expect(asApp(() => tags.merge(alice, tag.id, tag.id))).rejects.toMatchObject({ code: 'INVALID_TAG' });
    await expect(asApp(() => tags.merge(alice, tag.id, bobs.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(asApp(() => tags.merge(alice, bobs.id, tag.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('remove', () => {
  it('deletes the tag from transactions and goals', async () => {
    const tag = await asApp(() => tags.create(alice, 'servis-motor'));
    const transaction = await transactionWith([tag.id]);
    await test.query(
      `INSERT INTO goals (user_id, name, icon, color, target_minor, currency, tag_id)
       VALUES ($1, 'Servis motor', 'wrench', 'amber', 1200000, 'IDR', $2)`,
      [alice, tag.id],
    );
    await expect(asApp(() => tags.remove(bob, tag.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await asApp(() => tags.remove(alice, tag.id));
    expect(await tagsOf(transaction)).toEqual([]);
    expect(await test.query('SELECT tag_id FROM goals')).toEqual([{ tag_id: null }]);
    await expect(asApp(() => tags.remove(alice, tag.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('similar', () => {
  it('pairs plurals, prefixes, and typos of longer slugs', async () => {
    const slugs = [
      'book',
      'books',
      'bus',
      'buses',
      'kopi',
      'kopi-susu',
      'liburan',
      'liburn',
      'ab',
      'abc',
      'kado',
      'kade',
    ];
    for (const slug of slugs) {
      await asApp(() => tags.create(alice, slug));
    }
    await asApp(() => tags.create(bob, 'bookes'));
    expect(await asApp(() => tags.similar(alice))).toEqual([
      { a: 'book', b: 'books' },
      { a: 'bus', b: 'buses' },
      { a: 'kopi', b: 'kopi-susu' },
      { a: 'liburan', b: 'liburn' },
    ]);
  });
});

describe('roles', () => {
  it('is not writable by the worker', async () => {
    await expect(test.as('wf_worker', () => tags.create(alice, 'kopi'))).rejects.toMatchObject(
      pgError(/permission denied for table tags/),
    );
  });
});
