#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Self-host SeaweedFS node (D25): master + volume + filer + S3 in one process, reachable only on the compose
# `internal` network. The app's S3 identity comes from the secrets volume that `init` filled (only its `s3/` directory
# is mounted here); the identity config is written to a tmpfs, never to disk, and allows only the app buckets.
# Then the buckets are created (idempotent) and the container is marked ready for its healthcheck.
set -eu

READY_MARKER=/tmp/wf-buckets-ready
BUCKETS="wf-attachments wf-avatars wf-reports wf-exports"
CONFIG=/run/wf-s3/s3.json
rm -f "$READY_MARKER"

actions=""
for bucket in $BUCKETS; do
  for action in Read Write List Tagging; do
    actions="${actions:+$actions,}\"$action:$bucket\""
  done
done
# Keys are base64url (apps/launcher/src/secrets.ts), so they need no JSON escaping.
(
  umask 077
  printf '{"identities":[{"name":"write-financial","credentials":[{"accessKey":"%s","secretKey":"%s"}],"actions":[%s]}]}\n' \
    "$(cat /run/wf-secrets/access_key_id)" "$(cat /run/wf-secrets/secret_access_key)" "$actions" >"$CONFIG"
)
chown seaweed:seaweed /run/wf-s3 "$CONFIG"
if [ "$(stat -c %u /data)" != "$(id -u seaweed)" ]; then chown -R seaweed:seaweed /data; fi

su-exec seaweed weed server \
  -dir=/data \
  -volume.max=0 \
  -master.volumeSizeLimitMB=1024 \
  -s3 \
  -s3.port=8333 \
  -s3.config="$CONFIG" &
weed_pid=$!
trap 'kill -TERM "$weed_pid" 2>/dev/null' INT TERM

until wget -q -O /dev/null http://127.0.0.1:8333/healthz; do
  kill -0 "$weed_pid" || exit 1
  sleep 1
done

existing="$(echo 's3.bucket.list' | weed shell -master=127.0.0.1:9333)"
for bucket in $BUCKETS; do
  if printf '%s\n' "$existing" | grep -Eq "^[[:space:]]*${bucket}([[:space:]]|$)"; then
    echo "bucket ${bucket}: exists"
  else
    echo "s3.bucket.create -name ${bucket}" | weed shell -master=127.0.0.1:9333 >/dev/null
    echo "bucket ${bucket}: created"
  fi
done
touch "$READY_MARKER"

# `wait` returns early when the trap fires; wait again for weed to finish shutting down.
wait "$weed_pid" || wait "$weed_pid"
