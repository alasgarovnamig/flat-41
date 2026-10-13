// Package app wires shared dependencies. Every module receives *Deps and registers its routes and jobs.
package app

import (
	"context"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/config"
	"github.com/alasgarovnamig/evtap/api/internal/core/audit"
	"github.com/alasgarovnamig/evtap/api/internal/core/events"
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
	Signer   *auth.Signer
	Auth     *auth.Service
	Jobs     *Scheduler

	// Cross-module services (see contracts.go). The owning module assigns its implementation in its New();
	// other modules only call them lazily (inside handlers / jobs), never during construction.
	Listings   ListingsAPI
	Promotions PromotionsAPI
	Wallet     WalletAPI
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
