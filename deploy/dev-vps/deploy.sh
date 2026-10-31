#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# Runs on the dev VPS (deploy/dev-vps/README.md) after the image `write-financial:<tag>` was loaded:
#   deploy/dev-vps/deploy.sh dev-<short sha>
# Dumps the database first (the dev lane runs no tests, so every deploy keeps a way back), switches the image tag in
# deploy/compose/.env, and brings the stack up; init applies pending migrations before web and worker start.
set -euo pipefail

tag="${1:?usage: deploy.sh <image tag>}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
compose_dir="$root/deploy/compose"
backups="$root/backups"
keep=10

cd "$compose_dir"
test -f .env || { echo "missing $compose_dir/.env" >&2; exit 1; }
docker image inspect "write-financial:$tag" >/dev/null

# 1. A plain pg_dump of the current data, unless this is the very first start.
mkdir -p "$backups"
if [ -n "$(docker compose ps -q --status running postgres 2>/dev/null)" ]; then
	dump="$backups/pre-$tag-$(date -u +%Y%m%dT%H%M%SZ).dump"
	docker compose exec -T postgres pg_dump -U postgres -Fc write_financial >"$dump"
	chmod 600 "$dump"
	echo "pre-deploy dump: $dump ($(du -h "$dump" | cut -f1))"
	ls -1t "$backups"/pre-*.dump | tail -n +$((keep + 1)) | xargs -r rm -f
fi

# 2. The image this deploy runs.
sed -i -E "s/^WF_VERSION=.*/WF_VERSION=$tag/" .env
grep -q '^WF_VERSION=' .env || echo "WF_VERSION=$tag" >>.env

# 3. Up: init (secrets, roles, migrations) → web + worker → caddy, waiting for every healthcheck.
docker compose up -d --wait --wait-timeout 300 --remove-orphans

# 4. The app answers through Caddy with its real certificate.
domain="$(sed -n -E 's/^WF_DOMAIN=(.*)$/\1/p' .env)"
for _ in $(seq 1 30); do
	if curl -fsS --resolve "$domain:443:127.0.0.1" "https://$domain/healthz" >/dev/null; then
		echo "healthy: https://$domain ($tag)"
		break
	fi
	sleep 2
done
curl -fsS --resolve "$domain:443:127.0.0.1" "https://$domain/healthz" >/dev/null

# 5. Old app images: keep this one and the one before it.
docker image ls write-financial --format '{{.Tag}} {{.CreatedAt}}' | sort -k2 -r | awk 'NR>2 {print $1}' |
	while read -r old; do [ "$old" = "$tag" ] || docker image rm "write-financial:$old" >/dev/null || true; done
docker image prune -f >/dev/null
