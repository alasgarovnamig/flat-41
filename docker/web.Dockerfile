# EvTap website (Next.js standalone server). Build from the repository root:
#   docker build -f docker/web.Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.evtap.az --build-arg NEXT_PUBLIC_WEB_URL=https://evtap.az -t evtap/web .
FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @evtap/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_WEB_URL=http://localhost:3000
ARG NEXT_IMAGE_UNOPTIMIZED=0
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_WEB_URL=$NEXT_PUBLIC_WEB_URL NEXT_IMAGE_UNOPTIMIZED=$NEXT_IMAGE_UNOPTIMIZED NEXT_OUTPUT=standalone
RUN pnpm --filter @evtap/shared build && pnpm --filter @evtap/web exec next build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
