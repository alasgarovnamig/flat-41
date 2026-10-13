# Mock bank (fake card acquirer). Build from the repository root:
#   docker build -f apps/mockbank/Dockerfile -t evtap/mockbank .
#   docker run -p 4100:4100 -e DATABASE_URL=postgres://evtap:evtap@host.docker.internal:5432/mockbank evtap/mockbank

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

# ---- build: install all deps for this package only, compile TypeScript
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/mockbank/package.json apps/mockbank/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @evtap/mockbank...
COPY tsconfig.base.json ./
COPY apps/mockbank/tsconfig.json apps/mockbank/tsconfig.build.json apps/mockbank/
COPY apps/mockbank/src apps/mockbank/src
RUN pnpm --filter @evtap/mockbank build

# ---- prod-deps: only this package's runtime dependencies (express, pg) — not the whole hoisted workspace
FROM base AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/mockbank/package.json apps/mockbank/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm --filter @evtap/mockbank deploy --prod --legacy /out

# ---- runtime
FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=4100
WORKDIR /app
COPY --from=prod-deps --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/mockbank/package.json ./package.json
COPY --from=build --chown=node:node /repo/apps/mockbank/dist ./dist
USER node
EXPOSE 4100
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1
CMD ["node", "dist/index.js"]
