# Self-hosting write.financial: backups and restore

`docker compose run --rm backup` writes one encrypted archive of the whole instance: the database and every stored
file. This page covers the encryption key, the daily schedule, the off-site copy, the restore runbook, and the monthly
restore test. It assumes the installation from [install.md](install.md).

## What is in a backup, and what is not

Each run writes `wf-<UTC time>.tar.age` (for example `wf-20261018T200000Z.tar.age`) into the `backups` Docker volume.
It is a tar file encrypted with [age](https://age-encryption.org) to your public key, holding:

| Entry                    | Content                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `db.dump`                | `pg_dump` (custom format) of the whole database                                                  |
| `objects/<bucket>/<key>` | every object of the `attachments`, `avatars`, `reports`, and `exports` buckets, byte for byte     |
| `manifest.json`          | format version, time, app version, migration level, object counts, size and SHA-256 of each entry |

The stored files are already encrypted by the app with each user's key before they reach object storage, so the
archive holds them as ciphertext. Secrets inside the database (2FA secrets, notes, connected-account tokens) are
encrypted too. Everything else in the database (names, email addresses, transactions) is protected by the archive's
age encryption.

**Not in the archive, by design:** the key-encryption key (KEK) and the auth secret from the `secrets` volume. The
`backup` container cannot even read them: it mounts only the database passwords and the S3 keys. Someone who gets an
archive and your age private key still cannot read the encrypted values, the files, or the 2FA secrets without the KEK
and the auth secret. Keep those two files backed up separately ([install.md, step 4](install.md#4-back-up-the-key-encryption-key-kek-and-the-auth-secret)):
**a restore needs the KEK and the auth secret of the instance that made the backup.** Without the KEK, every encrypted
value and every file is lost for good; without the auth secret, nobody can sign in with two-step verification.

Retention: after each run, archives older than `BACKUP_RETENTION_DAYS` (default 30) are deleted from the volume, so
the data of a deleted account disappears from local backups 30 days after its deletion. Apply the same retention to
your off-site copy.

## 1. Make the backup key pair, offline

Archives are encrypted to an age **public key** on the server; only the matching **private key** (the "identity") can
decrypt them, and it must not be on the server. Make the pair on your own computer, not on the server:

```sh
# https://github.com/FiloSottile/age#installation: apt install age, brew install age, …
age-keygen -o write-financial-backup.key
# Public key: age1…
```

Store `write-financial-backup.key` like the KEK: two offline places (a password manager and an encrypted USB drive),
not on the server and not next to the backups. Put the **public key** line (`age1…`, also `age-keygen -y
write-financial-backup.key`) into the server's `.env`:

```sh
BACKUP_AGE_RECIPIENT=age1…
```

`backup` refuses to run without a recipient, and refuses a private key (`AGE-SECRET-KEY-…`) pasted by mistake.
To encrypt to several keys (for example a spare kept by a second person), use a recipients file instead: one `age1…`
per line, mounted into the `backup` service with a `docker-compose.override.yml` and named by
`BACKUP_AGE_RECIPIENT_FILE`.

Test it once:

```sh
docker compose run --rm backup
```

It prints the archive name and size, the migration level, and the object counts, then what the retention deleted.

## 2. Run it daily at 03.00 WIB

The `backup` service is not started by `docker compose up`; a timer on the host starts it. With systemd (Debian,
Ubuntu, and most other distributions), create `/etc/systemd/system/write-financial-backup.service`, with the path of
your Compose directory:

```ini
[Unit]
Description=write.financial backup
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
WorkingDirectory=/opt/write.financial/deploy/compose
ExecStart=/usr/bin/docker compose run --rm backup
```

and `/etc/systemd/system/write-financial-backup.timer`:

```ini
[Unit]
Description=Daily write.financial backup at 03.00 WIB

[Timer]
OnCalendar=*-*-* 03:00:00 Asia/Jakarta
# Runs at the next boot when the server was off at 03.00.
Persistent=true

[Install]
WantedBy=timers.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now write-financial-backup.timer
systemctl list-timers write-financial-backup.timer
journalctl -u write-financial-backup.service   # output of the last runs
```

A failed run exits non-zero, so the service shows as failed (`systemctl --failed`); hook your monitoring to that.
With cron instead, WIB has no daylight saving time, so 03.00 WIB is always 20.00 UTC:
`0 20 * * * cd /opt/write.financial/deploy/compose && docker compose run --rm backup` (on a UTC server).

A run never leaves a partial archive under its final name: it writes `.wf-….tar.age.partial`, renames it only when it
is complete, and deletes it on failure. A run that is killed leaves the partial file, which the next run deletes once
it is a day old.

## 3. Copy the archives off-site

A backup on the same disk as the data does not survive the loss of the server. Copy the archives somewhere else after
each run, for example with [rclone](https://rclone.org) to any S3-compatible or cloud storage, by adding to the
`[Service]` section above:

```ini
ExecStartPost=/bin/sh -c 'rclone copy --max-age 48h "$(docker volume inspect -f "{{.Mountpoint}}" write-financial_backups)" offsite:write-financial-backups'
```

The archives are encrypted, so the off-site storage only ever sees ciphertext. Give the copy a lifecycle rule that
deletes objects after 30 days (or your `BACKUP_RETENTION_DAYS`), and give the server credentials that can write but not
delete or overwrite, so that a compromised server cannot destroy the copies. Only restore archives from storage that
only you can write to: the checksums in the manifest detect corruption, but anyone with the public key could make an
archive.

To fetch one archive by hand: `docker compose run --rm --no-deps -T backup sh -c 'cat /backups/wf-….tar.age' >
wf-….tar.age`.

## 4. Restore

`restore` replaces the database and every stored file with the content of an archive. It needs the age private key at
run time (on stdin or as a file), the archive, and a `secrets` volume with the **KEK and the auth secret of the
instance that made the backup**.

1. **New server only:** install as in [install.md](install.md) steps 1–2 (the same `WF_VERSION` as the backup or a
   newer one; `restore` refuses archives of a newer version). Before the first `docker compose up`, put the KEK and the
   auth secret into the new `secrets` volume, so that `init` keeps them and generates only the rest:

   ```sh
   docker compose run --rm --no-deps -T init sh -c 'umask 077 && cat > /run/wf-secrets/kek' < write-financial-kek.backup
   docker compose run --rm --no-deps -T init sh -c 'umask 077 && cat > /run/wf-secrets/auth_secret' < write-financial-auth-secret.backup
   docker compose up -d --wait
   docker compose logs init    # "Secrets: generated …" must not list kek or auth_secret
   ```

   The other secrets (database role passwords, Valkey, S3) may be new: the archive does not depend on them.

2. Stop the app, so that nothing writes while the data is replaced:

   ```sh
   docker compose stop web worker
   ```

3. Put the archive into the backups volume (skip this if it is still there), then restore it with the private key on
   stdin. `-T` is needed for stdin:

   ```sh
   docker compose run --rm --no-deps -T backup sh -c 'umask 077 && cat > /backups/wf-20261018T200000Z.tar.age' < wf-20261018T200000Z.tar.age
   docker compose run --rm -T backup restore wf-20261018T200000Z.tar.age < write-financial-backup.key
   ```

   The private key is used in memory and never written to the server. Alternatively, mount it read-only and pass
   `--identity /run/backup.key` (`-v ./write-financial-backup.key:/run/backup.key:ro`), then delete it from the server.

4. Start the app again: `docker compose up -d --wait`.

What `restore` does:

- decrypts the whole archive once and checks every entry against the SHA-256 list of the manifest **before changing
  anything**; a wrong key, a damaged archive, or one that does not match its manifest stops here;
- refuses while the app still has open connections to the database, and refuses an archive whose database is newer
  than this version of the app;
- refuses unless the database is empty (no users, as on a fresh installation); `--force` replaces a database that
  has users (`restore --force wf-….tar.age`), so make a backup of the current state first;
- drops everything the app's database owner `wf_migrate` owns, re-applies the role grants, and restores the dump as
  `wf_migrate` in one transaction, with the grants and Row-Level Security policies from the dump; the SQL in an
  archive never runs with superuser rights;
- puts every object back and deletes stored objects that are not in the archive, so database and files are from the
  same point in time;
- applies the migrations of this version on top (an archive of an older version is migrated forward) and prints a
  summary.

Sessions and the queues in Valkey are not part of the backup: users stay signed in if their session is in the backup,
and scheduled jobs are planned again by the worker.

## 5. Test a restore every month

A backup that was never restored is a hope, not a backup. Once a month (and after every upgrade), restore the latest
archive on another machine or into a separate Compose project on the same server, which does not touch the running
instance (no ports are published without Caddy):

```sh
cp .env /tmp/restore-test.env   # same POSTGRES_PASSWORD is not needed; any value works
docker compose -p wf-restore-test --env-file /tmp/restore-test.env run --rm --no-deps -T init sh -c 'umask 077 && cat > /run/wf-secrets/kek' < write-financial-kek.backup
docker compose -p wf-restore-test --env-file /tmp/restore-test.env run --rm --no-deps -T init sh -c 'umask 077 && cat > /run/wf-secrets/auth_secret' < write-financial-auth-secret.backup
docker compose -p wf-restore-test --env-file /tmp/restore-test.env up -d --wait web worker
docker compose -p wf-restore-test --env-file /tmp/restore-test.env stop web worker
docker compose -p wf-restore-test --env-file /tmp/restore-test.env run --rm --no-deps -T backup sh -c 'cat > /backups/latest.tar.age' < wf-….tar.age
docker compose -p wf-restore-test --env-file /tmp/restore-test.env run --rm -T backup restore latest.tar.age < write-financial-backup.key
docker compose -p wf-restore-test --env-file /tmp/restore-test.env down -v   # when done
```

The restore succeeds only if the archive decrypts with your offline key, matches its manifest, and loads into a fresh
database with the KEK and auth secret you keep: that checks the key, the archives, and the secrets in one go. To check
that files decrypt as well, start that project's web too (`up -d --wait` and a `docker-compose.override.yml` that
publishes it on `127.0.0.1`), sign in, and open an attachment.

The CI job "Backup restore (compose)" runs the same cycle on every change
([`deploy/ci/backup-restore.sh`](../../deploy/ci/backup-restore.sh)).

## Consistency

`pg_dump` reads the whole database in one snapshot; the objects are copied right after the dump. Objects are never
overwritten (every upload gets a new random key) and are stored before the row that references them is committed, so
every file the dump references is already in storage when the copy starts. The copy may also contain files uploaded
after the dump, which nothing in the restored database references; they are harmless ciphertext. A file deleted
while the copy runs would be missing from the archive, so the app deletes stored files only after the rows that
reference them are gone and with a delay longer than a backup run takes; a restored row never points at a file that
was deleted before the backup started.

## Design notes

- **Encryption:** [`age-encryption`](https://www.npmjs.com/package/age-encryption), the TypeScript implementation of
  age by the format's author, inside the launcher: no extra binary in the image, and streaming, so the plaintext never
  touches the disk. The archives are standard age files that the `age` command line tool decrypts (the CI job checks
  that with the reference implementation).
- **Database role:** `pg_dump` runs as the PostgreSQL superuser, because every table has `FORCE ROW LEVEL SECURITY`:
  even their owner `wf_migrate` sees no rows without a policy, and `pg_dump` as `wf_migrate` fails ("query would be
  affected by row-level security policy"). `pg_restore` runs as `wf_migrate`, the least privilege that can recreate
  the schema.
- **Tools:** `pg_dump` and `pg_restore` 18 from the PostgreSQL project's apt repository (PGDG), installed in the image.
