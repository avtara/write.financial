<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Dev VPS (dev.write.financial)

Every push to `dev` is deployed here by [`.github/workflows/deploy-dev.yml`](../../.github/workflows/deploy-dev.yml),
**without tests**: `dev` is for feature work, and the full CI lane runs on the way to `main`
([CONTRIBUTING.md › CI lanes](../../CONTRIBUTING.md#ci-lanes)).

- **Server:** SemutSSH Cloud (Tencent Cloud ap-jakarta underneath), Ubuntu 24.04, 2 vCPU / 2 GB RAM, user `ubuntu`, files
  in `/opt/write.financial`.
- **Stack:** the self-host Compose stack ([`deploy/compose`](../compose)) plus [`compose.override.yml`](compose.override.yml),
  which only swaps Caddy's site file for [`Caddyfile`](Caddyfile): the app on `dev.write.financial`, and
  `write.financial` / `www.write.financial` redirected there with a 302.
- **DNS:** Cloudflare zone `write.financial`, three `A` records to the server, DNS only (not proxied), so Caddy gets its
  own Let's Encrypt certificates and sees client IPs.
- **Firewall:** `ufw` allows 22, 80, 443 (TCP) and 443 (UDP). In front of it, the provider firewall (SemutSSH Cloud
  panel › Servers › `write-financial` › Firewall) allows TCP 22, 80, 443 and ICMP; UDP 443 is closed there, so
  browsers use HTTP/2 instead of HTTP/3.

## What a deploy does

1. GitHub Actions builds `deploy/docker/Dockerfile` as `write-financial:dev-<short sha>` and streams it to the server
   with `docker save | ssh … docker load` (no registry).
2. It syncs `deploy/compose` and `deploy/dev-vps` to `/opt/write.financial/deploy/` (the server's `.env` is kept).
3. [`deploy.sh`](deploy.sh) dumps the database to `/opt/write.financial/backups/pre-<tag>-<time>.dump` (the last 10
   are kept), sets `WF_VERSION`, and runs `docker compose up -d --wait`: `init` applies pending migrations before web
   and worker start. It fails the job unless `https://dev.write.financial/healthz` answers through Caddy.

Repository secrets: `DEV_VPS_HOST`, `DEV_VPS_USER`, `DEV_VPS_SSH_KEY` (a key used only by this workflow),
`DEV_VPS_KNOWN_HOSTS`.

## Server `.env` (`/opt/write.financial/deploy/compose/.env`, mode 600)

```dotenv
COMPOSE_FILE=docker-compose.yml:../dev-vps/compose.override.yml
WF_IMAGE=write-financial
WF_VERSION=dev-<short sha>   # set by deploy.sh
WF_DOMAIN=dev.write.financial
PUBLIC_URL=https://dev.write.financial
POSTGRES_PASSWORD=<random>
DEPLOYMENT_MODE=selfhost
LOG_LEVEL=info
```

Google sign-in and Gmail are enabled with all five Google variables from
[`deploy/compose/.env.example`](../compose/.env.example) (all five or none). They point at the Cloud project
`write-financial`:

- **OAuth client** `write.financial web` (Web application), shared with local development. Its authorized origins include
  `https://dev.write.financial`; its redirect URIs include `https://dev.write.financial/api/auth/callback/google`
  (sign-in) and `https://dev.write.financial/api/gmail/callback` (Gmail). `GOOGLE_CLIENT_SECRET` is the same secret as in
  the developer `.env`.
- **Consent screen:** External, publishing status *Testing*, scopes `openid`, `email`, `profile`, `gmail.readonly`.
  Only the listed test users can consent, and their Gmail refresh tokens expire after seven days, so Gmail must be
  reconnected weekly.
- **Pub/Sub:** topic `projects/write-financial/topics/gmail-push` (publisher: `gmail-api-push@system.gserviceaccount.com`)
  and push subscription `gmail-push-dev` to `https://dev.write.financial/api/gmail/push`, authenticated with OIDC as
  `gmail-push@write-financial.iam.gserviceaccount.com` (audience = the endpoint URL). Pub/Sub's service agent has
  `roles/iam.serviceAccountTokenCreator` on that service account.

## Secrets

The `secrets` volume holds the KEK and `auth_secret` next to the generated database, Valkey, and S3 credentials. The
KEK is the one the data was encrypted with on the developer machine it was copied from; `auth_secret` is the
server's own. Neither is in the database dumps: keep an offline copy of both
(`docker compose cp web:/run/wf-secrets/kek …`, see [docs/self-host/install.md](../../docs/self-host/install.md)).

## Rolling back

```sh
cd /opt/write.financial/deploy/compose
docker compose stop web worker
docker compose exec -T postgres pg_restore -U postgres -d write_financial --clean --if-exists < ../../backups/pre-<tag>-<time>.dump
bash ../dev-vps/deploy.sh <previous tag>   # the previous image is kept on the server
```
