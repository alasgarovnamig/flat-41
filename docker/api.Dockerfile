# EvTap API (Go). Build from the repository root:
#   docker build -f docker/api.Dockerfile -t evtap/api .
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY apps/api/go.mod apps/api/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY apps/api/ ./
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate && \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/seed ./cmd/seed

FROM alpine:3.22
# libwebp: fast native WebP encoding for uploads (falls back to a bundled WASM encoder when missing)
RUN apk add --no-cache ca-certificates tzdata libwebp && adduser -D -u 10001 evtap && mkdir -p /data/uploads && chown evtap /data/uploads
ENV PORT=4000 UPLOAD_DIR=/data/uploads NODE_ENV=production
COPY --from=build /out/ /app/
USER evtap
EXPOSE 4000
VOLUME ["/data/uploads"]
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/v1/health" >/dev/null || exit 1
# Migrations run automatically on start. Demo data: docker compose exec api /app/seed
ENTRYPOINT ["/app/api"]
