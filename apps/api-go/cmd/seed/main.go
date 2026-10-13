// Seeds demo data (idempotent). Usage: go run ./cmd/seed   (SEED_IMAGES=local → offline placeholder photos)
// TODO (marketplace workstream): port the full demo dataset from the former apps/api/src/db/seed.ts.
package main

import (
	"context"
	"log/slog"
	"os"

	"golang.org/x/crypto/bcrypt"

	"github.com/alasgarovnamig/evtap/api/internal/config"
	"github.com/alasgarovnamig/evtap/api/internal/core/settings"
	"github.com/alasgarovnamig/evtap/api/internal/db"
)

func main() {
	cfg := config.Load()
	ctx := context.Background()
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("connect", "err", err)
		os.Exit(1)
	}
	defer pool.Close()
	if err := db.Migrate(pool); err != nil {
		slog.Error("migrate", "err", err)
		os.Exit(1)
	}
	if err := settings.EnsureDefaults(ctx, pool); err != nil {
		slog.Error("defaults", "err", err)
		os.Exit(1)
	}
	hash, _ := bcrypt.GenerateFromPassword([]byte(cfg.Admin.Password), 10)
	if _, err := pool.Exec(ctx, `insert into users (name, email, password_hash, role, is_email_verified) values ('Admin', $1, $2, 'ADMIN', true)
		on conflict do nothing`, cfg.Admin.Email, string(hash)); err != nil {
		slog.Error("admin", "err", err)
		os.Exit(1)
	}
	slog.Info("✔ admin", "email", cfg.Admin.Email, "password", cfg.Admin.Password)
}
