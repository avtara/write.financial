#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Backup → restore proof on the self-host Compose stack (CI job "Backup restore (compose)"; locally the same):
#
#   docker build -f deploy/docker/Dockerfile -t write-financial:ci .
#   deploy/ci/backup-restore.sh
#
# Needs docker compose, age (age-keygen and age -d: the reference CLI reads what the app wrote), jq, tar, and
# `pnpm install` in the repository: the seed/verify script (apps/launcher/test/backup-proof.ts) runs from this checkout
# in the image's Node.js, on the stack's internal network with its secrets volume, as web does. Uses its
# own Compose project (wf-backup-proof) without Caddy, so it publishes no ports and leaves other stacks alone.
#
# 1. Starts the stack, creates a user, its DEK, and an encrypted PNG attachment holding a random marker.
# 2. `backup` refuses without an age recipient, then writes an archive that holds no plaintext: neither the marker nor
#    a PNG signature nor the email in the age file; and once decrypted, neither the marker, a PNG signature, the KEK,
#    nor the auth secret in the dump or the objects (which are ciphertext already).
# 3. Deletes the stack with every volume, starts a new one with only the old KEK and auth secret, stops web and
#    worker, and restores; a second restore refuses because the database now has data.
# 4. The user row is back, its DEK unwraps with the KEK, and the object decrypts to the original bytes.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
image="${WF_IMAGE:-write-financial}:${WF_VERSION:-ci}"
work="$(mktemp -d)"

compose() {
  docker compose --project-directory "$root/deploy/compose" -f "$root/deploy/compose/docker-compose.yml" \
    -p wf-backup-proof --env-file "$work/.env" --profile backup "$@"
}
proof() {
  docker run --rm --network wf-backup-proof_internal --user 10001:10001 -v "$root:/repo:ro" \
    -v wf-backup-proof_secrets:/run/wf-secrets:ro -e WF_SECRETS_DIR=/run/wf-secrets -e PUBLIC_URL=https://localhost \
    -e S3_ENDPOINT=http://seaweedfs:8333 --entrypoint node "$image" /repo/apps/launcher/test/backup-proof.ts "$@"
}
step() { printf '\n==> %s\n' "$*"; }
fail() {
  echo "FAILED: $*" >&2
  exit 1
}
cleanup() {
  local status=$?
  if [ "$status" -ne 0 ]; then compose logs --no-color >&2 || true; fi
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT

umask 077
age-keygen -o "$work/backup.key" 2>/dev/null
{
  echo "WF_IMAGE=${image%:*}"
  echo "WF_VERSION=${image##*:}"
  echo WF_DOMAIN=localhost
  echo PUBLIC_URL=https://localhost
  echo "POSTGRES_PASSWORD=$(openssl rand -base64 32)"
  echo "BACKUP_AGE_RECIPIENT=$(age-keygen -y "$work/backup.key")"
} >"$work/.env"

step "Start the stack and create a user, its DEK, and an encrypted attachment"
compose up -d --wait --wait-timeout 300 web worker
seed="$(proof seed)"
echo "$seed"
marker="$(jq -r .marker <<<"$seed")"
email="$(jq -r .email <<<"$seed")"
[ -n "$marker" ] && [ "$marker" != null ] || fail "no marker in the seed output"

step "backup refuses to run without an age recipient"
if compose run --rm -e BACKUP_AGE_RECIPIENT= backup >"$work/refused.log" 2>&1; then fail "backup ran unencrypted"; fi
cat "$work/refused.log"
grep -q 'No age recipient is configured' "$work/refused.log" || fail "unexpected refusal message"
[ -z "$(compose run --rm --no-deps -T backup sh -c 'ls -A /backups')" ] || fail "the refused backup left a file"

step "backup"
compose run --rm backup
name="$(compose run --rm --no-deps -T backup sh -c 'cd /backups && ls wf-*.tar.age')"
[ "$(wc -l <<<"$name")" -eq 1 ] || fail "expected one archive, got: $name"
compose run --rm --no-deps -T backup sh -c "cat /backups/$name" >"$work/$name"
ls -l "$work/$name"

step "The archive holds no plaintext"
[ "$(head -c 22 "$work/$name")" = "age-encryption.org/v1" ] || fail "not an age file"
# The PNG signature up to its first newline (grep -F splits patterns at newlines).
png=$'\x89PNG\r'
for needle in "$marker" "$email" "$png" "manifest.json"; do
  if LC_ALL=C grep -aqF -- "$needle" "$work/$name"; then fail "the archive contains plaintext"; fi
done
echo "no marker, email, PNG signature, or tar entry name in $name"

step "Decrypted with the reference age CLI: a tar whose dump and objects hold no secret or image"
compose run --rm --no-deps -T web sh -c 'cat /run/wf-secrets/kek' >"$work/kek"
compose run --rm --no-deps -T web sh -c 'cat /run/wf-secrets/auth_secret' >"$work/auth_secret"
mkdir "$work/inner"
age -d -i "$work/backup.key" "$work/$name" | tar -x -C "$work/inner"
(cd "$work/inner" && find . -type f | sort)
jq -c '{createdAt, appVersion, migrations, objects}' "$work/inner/manifest.json"
docker run --rm -i --entrypoint pg_restore "$image" -f - <"$work/inner/db.dump" >"$work/dump.sql"
grep -qF "$email" "$work/dump.sql" || fail "the dump does not contain the user (wrong database?)"
kek_keys="$(grep -o '^v[0-9]*:.*' "$work/kek" | cut -d: -f2)"
[ -n "$kek_keys" ] || fail "no key in the KEK file"
for needle in "$marker" "$png" "$(cat "$work/auth_secret")" $kek_keys; do
  if LC_ALL=C grep -raqF -- "$needle" "$work/inner" "$work/dump.sql"; then fail "the decrypted archive contains a secret or plaintext image"; fi
done
echo "the dump (as SQL) and the objects hold no marker, PNG signature, KEK, or auth secret"

step "Delete the stack with every volume, then start a new one with only the old KEK and auth secret"
compose down -v
compose run --rm --no-deps -T init sh -c 'umask 077 && cat > /run/wf-secrets/kek' <"$work/kek"
compose run --rm --no-deps -T init sh -c 'umask 077 && cat > /run/wf-secrets/auth_secret' <"$work/auth_secret"
compose up -d --wait --wait-timeout 300 web worker
compose logs init | grep -F 'Secrets: generated' | grep -vqE 'kek|auth_secret' || fail "init replaced the KEK or auth secret"
compose run --rm --no-deps -T backup sh -c "umask 077 && cat > /backups/$name" <"$work/$name"

step "restore"
compose stop web worker
compose run --rm -T backup restore "$name" <"$work/backup.key"

step "restore refuses to overwrite data without --force"
if compose run --rm -T backup restore "$name" <"$work/backup.key" >"$work/full.log" 2>&1; then fail "restore ran"; fi
cat "$work/full.log"
grep -q 'run the restore again with --force' "$work/full.log" || fail "unexpected refusal message"

step "The restored instance has the user, its DEK, and the object"
compose up -d --wait --wait-timeout 300 web worker
proof verify "$seed"

step "Backup restore proof passed"
