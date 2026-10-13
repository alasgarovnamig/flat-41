// Package app wires shared dependencies. Every module receives *Deps and registers its routes and jobs.
package app

import (
	"context"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/config"
	"github.com/alasgarovnamig/evtap/api/internal/core/audit"
	"github.com/alasgarovnamig/evtap/api/internal/core/events"
	"github.com/alasgarovnamig/evtap/api/internal/core/mail"
	"github.com/alasgarovnamig/evtap/api/internal/core/notify"
	"github.com/alasgarovnamig/evtap/api/internal/core/settings"
	"github.com/alasgarovnamig/evtap/api/internal/core/sms"
)

type Deps struct {
	Cfg      *config.Config
	Pool     *pgxpool.Pool
	Bus      *events.Bus
	Settings *settings.Service
	Notify   *notify.Service
	Audit    *audit.Service
	SMS      sms.Provider
	Mail     *mail.Service
	Signer   *auth.Signer
	Auth     *auth.Service
	Jobs     *Scheduler

	// Cross-module services (see contracts.go). The owning module assigns its implementation in its New();
	// other modules only call them lazily (inside handlers / jobs), never during construction.
	Listings   ListingsAPI
	Promotions PromotionsAPI
	Wallet     WalletAPI
	Push       PushAPI

	shutdownMu sync.Mutex
	shutdown   []func(ctx context.Context)
}

// OnShutdown registers fn to run on graceful shutdown before the HTTP server stops (e.g. closing WebSockets,
// which http.Server.Shutdown does not track because they are hijacked).
func (d *Deps) OnShutdown(fn func(ctx context.Context)) {
	d.shutdownMu.Lock()
	defer d.shutdownMu.Unlock()
	d.shutdown = append(d.shutdown, fn)
}

// Shutdown runs the OnShutdown hooks in reverse registration order.
func (d *Deps) Shutdown(ctx context.Context) {
	d.shutdownMu.Lock()
	hooks := append([]func(context.Context){}, d.shutdown...)
	d.shutdownMu.Unlock()
	for i := len(hooks) - 1; i >= 0; i-- {
		hooks[i](ctx)
	}
}

// Module is implemented by every feature package (internal/modules/*).
type Module interface {
	Routes(r chi.Router) // mounted under /api/v1
}

// Scheduler runs periodic jobs (replaces @nestjs/schedule). Jobs never overlap with themselves.
type Scheduler struct {
	jobs []job
}

type job struct {
	name  string
	every time.Duration
	fn    func(ctx context.Context) error
}

func (s *Scheduler) Every(name string, every time.Duration, fn func(ctx context.Context) error) {
	s.jobs = append(s.jobs, job{name: name, every: every, fn: fn})
}
