// Command mockbank runs the EvTap mock acquiring bank (docs/MOCKBANK.md).
package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"
	_ "time/tzdata" // Asia/Baku timestamps in the UI, even in distroless images

	"github.com/alasgarovnamig/evtap/mockbank/internal/app"
	"github.com/alasgarovnamig/evtap/mockbank/internal/config"
)

func main() {
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck())
	}
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "[mockbank] failed to start:", err)
		os.Exit(1)
	}
}

func run() error {
	env := config.FromOS(os.Environ())
	if b, err := os.ReadFile(".env"); err == nil {
		config.MergeDotEnv(env, string(b))
	}
	cfg, err := config.Load(env)
	if err != nil {
		return err
	}
	log := app.NewLogger(cfg.LogLevel)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	pool, err := app.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		cancel()
		return err
	}
	defer pool.Close()
	a := app.New(cfg, pool, log)
	err = a.Init(ctx)
	cancel()
	if err != nil {
		return err
	}

	ln, err := net.Listen("tcp", ":"+strconv.Itoa(cfg.Port))
	if err != nil {
		return err
	}
	srv := &http.Server{Handler: a.Handler(), ReadHeaderTimeout: 10 * time.Second}
	a.Scheduler.Start()
	log.Info(fmt.Sprintf("Mock bank listening on http://localhost:%d (public %s, env %s)", ln.Addr().(*net.TCPAddr).Port, cfg.PublicURL, cfg.Env))

	errCh := make(chan error, 1)
	go func() { errCh <- srv.Serve(ln) }()

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	select {
	case err := <-errCh:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case s := <-sig:
		log.Info(s.String() + " received, shutting down")
	}

	shutdownCtx, done := context.WithTimeout(context.Background(), 15*time.Second)
	defer done()
	a.Scheduler.Stop()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Warn("http shutdown", "err", err.Error())
	}
	a.Webhooks.Drain()
	return nil
}

// healthcheck is used by the Docker HEALTHCHECK (distroless images have no wget/curl).
func healthcheck() int {
	port := os.Getenv("PORT")
	if port == "" {
		port = "4100"
	}
	client := &http.Client{Timeout: 3 * time.Second, Transport: &http.Transport{Proxy: nil}}
	res, err := client.Get("http://127.0.0.1:" + port + "/health")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}
