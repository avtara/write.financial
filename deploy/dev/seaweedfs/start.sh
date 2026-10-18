#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Dev SeaweedFS node: master + volume + filer + S3 in one process (D25), then creates the
# write.financial buckets (idempotent) and marks the container ready for its healthcheck.
set -eu

READY_MARKER=/tmp/wf-buckets-ready
BUCKETS="wf-attachments wf-avatars wf-reports wf-exports"
rm -f "$READY_MARKER"

weed server \
  -dir=/data \
  -volume.max=10 \
  -master.volumeSizeLimitMB=1024 \
  -s3 \
  -s3.port=8333 \
  -s3.config=/etc/seaweedfs/s3.json &
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
