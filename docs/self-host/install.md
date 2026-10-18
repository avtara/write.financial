# Self-hosting write.financial: installation

write.financial runs as one Docker image (`ghcr.io/avtara/write.financial`) started in several roles by the Compose
file in [`deploy/compose/`](../../deploy/compose/):

| Service     | What it does                                                                                       | Network            |
| ----------- | -------------------------------------------------------------------------------------------------- | ------------------ |
| `caddy`     | HTTPS (automatic certificates, HSTS), HTTP → HTTPS redirect, reverse proxy to `web`                 | `edge`, ports 80/443 |
| `web`       | the app                                                                                            | `edge`, `internal` |
| `worker`    | background jobs                                                                                    | `internal`         |
| `init`      | one-shot on every start: generates missing secrets, creates database roles, runs migrations, exits | `internal`         |
| `postgres`  | PostgreSQL 18                                                                                      | `internal`         |
| `valkey`    | Valkey 9 (Redis-compatible) for queues and cache                                                   | `internal`         |
| `seaweedfs` | S3-compatible object storage for attachments (already encrypted by the app before upload)         | `internal`         |

Only Caddy publishes ports. The `internal` network has no route to the outside world, so PostgreSQL, Valkey, and
SeaweedFS are unreachable from other machines.

## Requirements

- A Linux server (x86-64 or arm64) with at least 2 GB RAM and 10 GB free disk. Put Docker's data directory on an
  encrypted disk (e.g. LUKS) and keep swap off or encrypted.
- Docker Engine 26 or newer with the Compose plugin 2.26 or newer (`docker compose version`).
- For a public instance: a domain name whose DNS `A`/`AAAA` record points at the server, and inbound TCP 80 and 443
  (plus UDP 443 for HTTP/3) open. Caddy needs outbound internet access to obtain certificates.

## 1. Get the Compose files

Use the files from the release you install (replace `v0.1.0`):

```sh
git clone --depth 1 --branch v0.1.0 https://github.com/avtara/write.financial.git
cd write.financial/deploy/compose
```

You need `docker-compose.yml`, `Caddyfile`, `seaweedfs/start.sh`, and `.env.example` from that directory; the rest of
the repository is not used at runtime.

## 2. Configure `.env`

```sh
cp .env.example .env
chmod 600 .env
```

Set at least:

- `WF_VERSION`: the image tag, e.g. `0.1.0` (recommended) or `latest`.
- `WF_DOMAIN`: your domain, e.g. `finance.example.com`. Use `localhost` to try it out on your own computer.
- `PUBLIC_URL`: `https://` + the domain, e.g. `https://finance.example.com`.
- `POSTGRES_PASSWORD`: a long random password, e.g. from `openssl rand -base64 32`. Only the `init` container uses it,
  to manage the app's database roles. It takes effect when the database volume is created; changing it in `.env`
  later does not change it inside PostgreSQL.

SMTP and Google sign-in are optional; mail can also be configured later in the setup wizard.

You do not set any other password or key. On first start `init` generates them into the `secrets` Docker volume:
the key-encryption key (KEK), the auth secret, the setup token, one password per database role (`wf_app`, `wf_worker`, `wf_auth`,
`wf_migrate`, `wf_readonly_ops`), the Valkey password, and the S3 credentials. They are random 256-bit values in
files with mode 0600, owned by the app user (uid 10001). Existing files are never overwritten. `web` and `worker`
mount the volume read-only; Valkey and SeaweedFS only see their own subdirectory.

## 3. First start

```sh
docker compose up -d --wait
docker compose logs init
```

`--wait` returns once every service is healthy. The `init` log lists the generated secrets, then
`Migrations are up to date.`, and ends with `init is done.` On the very first start it also prints a notice about
the KEK. Back it up before you continue (step 4).

While setup is pending, the `init` log also shows the setup URL with a one-time token:

```text
First-run setup is pending. Open this URL to create the admin account and configure the instance:

  https://finance.example.com/setup?token=…
```

Open that URL. The setup wizard creates the admin account, makes you turn on two-step verification (an authenticator
app, plus 10 backup codes to keep), then asks for the instance name, public URL, default language and time zone,
optional SMTP settings (with a test email), and the registration mode. It refuses `/setup` without the token, and for
good once setup is complete. Keep the URL private until setup is done: whoever opens it first sets up the instance.
`init` prints it again on every start until setup is complete, so `docker compose logs init` shows it later too;
afterwards it prints nothing about it. Registration is closed by default: after setup, new users need an invitation
(Settings › Instans, with the registration mode "Dengan undangan") or an admin who opens registration.

For a local trial with `WF_DOMAIN=localhost`, the URL starts with `https://localhost/setup`. Caddy uses its own
certificate authority, so the browser warns about the certificate.

## 4. Back up the key-encryption key (KEK)

Secrets inside the database (2FA secrets, notes, connected-account tokens) and every uploaded file are encrypted
with keys that are themselves encrypted with the KEK. **If you lose the KEK, that data cannot be recovered by anyone,
including from database backups.** Copy it right after the first start:

```sh
docker compose cp web:/run/wf-secrets/kek ./write-financial-kek.backup
chmod 600 ./write-financial-kek.backup
```

Store the copy offline in two separate places (e.g. a password manager and an encrypted USB drive), not next to
your database backups, then delete `./write-financial-kek.backup` from the server. The KEK never appears in logs.

To restore onto a new server, start once so the volume exists, stop the stack, put the file back into the
`secrets` volume as `kek` (mode 0600, owner 10001), and start again.

## Monitoring the job queues

Admins can open Bull Board at `https://<your domain>/admin/queues`. It needs an admin account with two-step
verification that signed in within the last 15 minutes (otherwise it asks you to sign in again), and it is read-only:
jobs cannot be retried, removed, or added from it. Its page is served with two Content Security Policy exceptions that
apply to `/admin/queues` only: `base-uri 'self'` and inline styles (`style-src 'self' 'unsafe-inline'`), which Bull
Board's interface needs; scripts still run only with the per-request nonce.

## Upgrading

Read the release notes, back up, then set the new `WF_VERSION` in `.env` (or keep `latest`) and run:

```sh
docker compose pull
docker compose up -d --wait
docker compose logs init
```

`init` runs again on every `up` and applies pending database migrations before `web` and `worker` start. If it
fails, `web` and `worker` keep their previous containers; `docker compose logs init` says why.

## Ports and firewall

- Open inbound TCP 80 and 443 (and UDP 443 for HTTP/3). Port 80 is needed for certificate issuance and redirects to
  HTTPS. Keep SSH open as you need it; close everything else.
- Docker publishes ports past host firewalls such as `ufw`. This Compose file publishes only Caddy's ports; do not
  add `ports:` to `postgres`, `valkey`, `seaweedfs`, `web`, or `worker`.
- For administration, reach the database through the container instead of a port:
  `docker compose exec postgres psql -U postgres -d write_financial`.

## Using your own reverse proxy

If the server already runs a reverse proxy on 80/443, the simplest setup keeps Caddy and changes the published ports
(e.g. `127.0.0.1:8443:443`) so your proxy forwards to it. To replace Caddy instead, add a
`docker-compose.override.yml` next to the Compose file:

```yaml
services:
  caddy:
    profiles: [disabled]
  web:
    ports:
      - '127.0.0.1:3000:3000'
```

Your proxy must then:

- terminate TLS and redirect HTTP to HTTPS; `PUBLIC_URL` must be the exact public `https://` URL,
- pass the original `Host` header and set `X-Forwarded-Proto: https`,
- set `X-Forwarded-For` to the client address it saw, replacing any client-supplied value (rate limits and the
  security log rely on it),
- send `Strict-Transport-Security: max-age=63072000; includeSubDomains` (the app sends it too, on its own responses).

## Verifying the image

Release images are signed with cosign (keyless) and carry an SBOM and a build provenance attestation:

```sh
cosign verify ghcr.io/avtara/write.financial:0.1.0 \
  --certificate-identity-regexp '^https://github.com/avtara/write.financial/.github/workflows/release.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
docker buildx imagetools inspect ghcr.io/avtara/write.financial:0.1.0 --format '{{ json .SBOM }}'
```

## Troubleshooting

- `init` fails with `password authentication failed for user "postgres"`: `POSTGRES_PASSWORD` in `.env` differs from
  the one the database volume was created with. Restore the original value.
- `init` fails with `Invalid configuration`: the message lists the `.env` settings to fix.
- A secret file was edited and is now group- or world-readable: `init` refuses it and prints the `chmod 600` command.
