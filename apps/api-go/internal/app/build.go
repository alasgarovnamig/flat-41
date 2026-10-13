package app

import (
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/config"
	"github.com/alasgarovnamig/evtap/api/internal/core/audit"
	"github.com/alasgarovnamig/evtap/api/internal/core/events"
	"github.com/alasgarovnamig/evtap/api/internal/core/notify"
	"github.com/alasgarovnamig/evtap/api/internal/core/settings"
	"github.com/alasgarovnamig/evtap/api/internal/core/sms"
)

// Build creates the shared dependencies (also used by cmd/seed and tests).
func Build(cfg *config.Config, pool *pgxpool.Pool) *Deps {
	bus := events.NewBus()
	st := settings.New(pool)
	signer := auth.NewSigner(cfg.JWT.AccessSecret, cfg.JWT.AccessTTL)
	smsP := sms.New(cfg.SMS.Provider)
	return &Deps{
		Cfg: cfg, Pool: pool, Bus: bus, Settings: st, Notify: notify.New(pool, bus), Audit: audit.New(pool), SMS: smsP,
		Signer: signer, Auth: auth.NewService(pool, cfg, signer, smsP, st), Jobs: &Scheduler{},
	}
}
