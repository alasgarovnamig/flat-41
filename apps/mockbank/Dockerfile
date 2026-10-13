# Mock bank (fake card acquirer, Go). Build from the repository root:
#   docker build -f apps/mockbank/Dockerfile -t evtap/mockbank .
#   docker run -p 4100:4100 -e DATABASE_URL=postgres://evtap:evtap@host.docker.internal:5432/mockbank evtap/mockbank

# ---- build: static binary (templates, CSS/JS and tzdata are embedded)
FROM golang:1.24-alpine AS build
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
WORKDIR /src
COPY apps/mockbank/go.mod apps/mockbank/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY apps/mockbank/cmd ./cmd
COPY apps/mockbank/internal ./internal
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -ldflags="-s -w" -o /out/mockbank ./cmd/mockbank

# ---- runtime: distroless, non-root (uid 65532)
FROM gcr.io/distroless/static-debian12:nonroot AS runtime
# NODE_ENV (or APP_ENV) = production hides the test-card table; docker-compose sets development.
ENV NODE_ENV=production PORT=4100
COPY --from=build /out/mockbank /mockbank
USER nonroot:nonroot
EXPOSE 4100
# No shell/wget in distroless: the binary checks GET /health itself.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD ["/mockbank", "healthcheck"]
ENTRYPOINT ["/mockbank"]
