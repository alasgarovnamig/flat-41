// EvTap API server.
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/config"
	"github.com/alasgarovnamig/evtap/api/internal/core/settings"
	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/server"
)

func main() {
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg := config.Load()
	if cfg.IsProd {
		slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if os.Getenv("SKIP_MIGRATIONS") != "1" {
		if err := db.Migrate(pool); err != nil {
			return fmt.Errorf("migrate: %w", err)
		}
	}
	if err := settings.EnsureDefaults(ctx, pool); err != nil {
		return fmt.Errorf("defaults: %w", err)
	}

	d := app.Build(cfg, pool)
	handler := server.New(d, server.Modules(d))
	d.Jobs.Start(ctx)

	srv := &http.Server{Addr: fmt.Sprintf(":%d", cfg.Port), Handler: handler, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	slog.Info("🚀 EvTap API", "url", fmt.Sprintf("http://localhost:%d%s", cfg.Port, server.APIPrefix), "env", cfg.Env)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	d.Bus.Wait()
	return nil
}
