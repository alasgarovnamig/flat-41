# EvTap admin dashboard (static SPA served by nginx). Build from the repository root:
#   docker build -f docker/admin.Dockerfile --build-arg VITE_API_URL=https://api.evtap.az -t evtap/admin .
FROM node:22-alpine AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/admin/package.json apps/admin/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @evtap/admin...
COPY packages/shared packages/shared
COPY apps/admin apps/admin
ARG VITE_API_URL=http://localhost:4000
ARG VITE_WEB_URL=http://localhost:3000
ENV VITE_API_URL=$VITE_API_URL VITE_WEB_URL=$VITE_WEB_URL
RUN pnpm --filter @evtap/shared build && pnpm --filter @evtap/admin build

FROM nginx:1.27-alpine
COPY docker/admin.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/admin/dist /usr/share/nginx/html
EXPOSE 80
