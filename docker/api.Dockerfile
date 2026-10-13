# EvTap API. Build from the repository root:
#   docker build -f docker/api.Dockerfile -t evtap/api .
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @evtap/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @evtap/shared build && pnpm --filter @evtap/api build
# Self-contained production node_modules (incl. @evtap/shared dist)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm --filter @evtap/api deploy --prod --legacy /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=4000 UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/api/package.json ./package.json
COPY --from=build --chown=node:node /repo/apps/api/dist ./dist
COPY --from=build --chown=node:node /repo/apps/api/drizzle ./drizzle
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 4000
VOLUME ["/data/uploads"]
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null || exit 1
# Apply migrations, then start. Seed demo data manually: docker compose exec api node dist/db/seed.js
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/main.js"]
