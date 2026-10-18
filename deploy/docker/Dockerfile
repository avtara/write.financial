# syntax=docker/dockerfile:1
# SPDX-License-Identifier: AGPL-3.0-only
#
# write.financial: one image for every process (D22), built from the repository root:
#   docker build -f deploy/docker/Dockerfile -t write-financial .
# Commands (apps/launcher): web (default), worker, init, healthcheck web|worker. Anything else runs as given.
#
# Every stage runs on the target platform, so native modules (sharp, msgpackr-extract, …) match the image.
# The runtime keeps the workspace layout (/app/apps/*, /app/packages/*): Node strips TypeScript types itself, but
# not under node_modules/, so workspace packages are symlinked from node_modules as in development (no `pnpm deploy`).

ARG NODE_IMAGE=node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5
# The processes that run from TypeScript sources: the launcher and the worker, with their workspace dependencies.
ARG RUNTIME_PROJECTS="--filter @wf/launcher... --filter @wf/worker..."

FROM ${NODE_IMAGE} AS pnpm
RUN npm install --global pnpm@12.14.0
WORKDIR /src
# Workspace manifests only, so the dependency layers stay cached until a manifest or the lockfile changes.
COPY --parents package.json pnpm-lock.yaml pnpm-workspace.yaml apps/*/package.json packages/*/package.json tools/*/package.json ./

FROM pnpm AS build
# Lifecycle scripts are skipped here; the only one needed (Paraglide compile) runs below, after the sources are copied.
RUN --mount=type=cache,id=wf-pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --ignore-scripts --store-dir /pnpm-store --filter '@wf/web...'
COPY . .
RUN pnpm --filter @wf/i18n compile && pnpm --filter @wf/web build
# Runtime sources of the TypeScript processes, without tests and dev-only files.
ARG RUNTIME_PROJECTS
RUN mkdir /out && for dir in $(pnpm $RUNTIME_PROJECTS exec pwd); do \
      rel="${dir#/src/}"; \
      tar -C /src -c --exclude=node_modules --exclude=test --exclude='*.test.ts' --exclude='*.test.tsx' \
        --exclude=tsconfig.json --exclude='*.md' --exclude=drizzle.config.ts "$rel" | tar -C /out -x; \
    done

FROM pnpm AS prod-deps
ARG RUNTIME_PROJECTS
# Production dependencies only; no lifecycle scripts (pnpm-workspace.yaml allows none anyway).
RUN --mount=type=cache,id=wf-pnpm-store,target=/pnpm-store \
    pnpm install --prod --frozen-lockfile --ignore-scripts --store-dir /pnpm-store $RUNTIME_PROJECTS

FROM ${NODE_IMAGE} AS runtime
# tini as PID 1 forwards signals and reaps zombies. npm, corepack and yarn are removed so nothing can install
# packages at runtime (their bytes stay in the base layer; this is about attack surface, not size).
RUN apt-get update \
    && apt-get install --yes --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && groupadd --system --gid 10001 wf \
    && useradd --system --uid 10001 --gid wf --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin wf \
    && install -d -o wf -g wf -m 0700 /run/wf-secrets

ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="write.financial" \
      org.opencontainers.image.description="Personal finance, self-hosted: web, worker and init in one image" \
      org.opencontainers.image.url="https://github.com/avtara/write.financial" \
      org.opencontainers.image.source="https://github.com/avtara/write.financial" \
      org.opencontainers.image.documentation="https://github.com/avtara/write.financial/blob/main/docs/self-host/install.md" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
# Owned by root and read-only for the app user. /run/wf-secrets (mode 0700, uid 10001) seeds the secrets volume.
COPY --from=prod-deps /src/ ./
COPY --from=build /out/ ./
COPY --from=build /src/apps/web/.output/ apps/web/.output/
COPY --chmod=0755 deploy/docker/entrypoint /usr/local/bin/wf-entrypoint

USER 10001:10001
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/wf-entrypoint"]
CMD ["web"]
