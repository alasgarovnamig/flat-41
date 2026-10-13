// Package push delivers mobile push notifications for every AppNotification (the notifications module calls
// Service.SendToUsers on events.NotificationCreated). Provider by PUSH_PROVIDER:
//
//	console (default) — log only
//	expo              — Expo push service for ExponentPushToken[...] tokens (batches of 100, receipts polling)
//	native            — routes by push_tokens.platform: ios → APNs (.p8 token auth), android/web → FCM HTTP v1,
//	                    Expo tokens → Expo (legacy app installs)
//
// Device token registration (POST/DELETE /users/me/push-tokens) belongs to the users module.
package push

import (
	"context"
	"log/slog"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/db"
)

const receiptsEvery = 5 * time.Minute

// Service implements app.PushAPI.
type Service struct {
	db       db.Querier
	Provider Provider
}

func NewService(q db.Querier, p Provider) *Service { return &Service{db: q, Provider: p} }

// SendToUsers sends a payload to all devices of the given users and deletes tokens the provider reported invalid.
func (s *Service) SendToUsers(ctx context.Context, userIDs []string, payload func(userID string) app.PushPayload) (int, error) {
	if len(userIDs) == 0 {
		return 0, nil
	}
	rows, err := s.db.Query(ctx, `select token, user_id::text, platform from push_tokens where user_id = any($1::uuid[])`, userIDs)
	if err != nil {
		return 0, err
	}
	var msgs []Message
	cache := map[string]app.PushPayload{}
	for rows.Next() {
		var m Message
		var userID string
		if err := rows.Scan(&m.To, &userID, &m.Platform); err != nil {
			rows.Close()
			return 0, err
		}
		p, ok := cache[userID]
		if !ok {
			p = payload(userID)
			cache[userID] = p
		}
		m.Title, m.Body, m.Data = p.Title, p.Body, p.Data
		msgs = append(msgs, m)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if len(msgs) == 0 {
		return 0, nil
	}
	res := s.Provider.Send(ctx, msgs)
	s.removeTokens(ctx, res.InvalidTokens)
	return len(msgs), nil
}

// CollectReceipts polls delayed delivery receipts (Expo) and deletes unregistered tokens.
func (s *Service) CollectReceipts(ctx context.Context) error {
	rc, ok := s.Provider.(ReceiptCollector)
	if !ok {
		return nil
	}
	s.removeTokens(ctx, rc.CollectReceipts(ctx).InvalidTokens)
	return nil
}

func (s *Service) removeTokens(ctx context.Context, tokens []string) {
	if len(tokens) == 0 {
		return
	}
	if _, err := s.db.Exec(ctx, `delete from push_tokens where token = any($1)`, tokens); err != nil {
		slog.Warn("push: removing invalid tokens failed", "err", err)
		return
	}
	slog.Info("push: removed unregistered push token(s)", "count", len(tokens))
}

type Module struct {
	d   *app.Deps
	Svc *Service
}

// New wires the provider from config and registers the service as d.Push.
func New(d *app.Deps) *Module { return NewWithProvider(d, FromConfig(d.Cfg)) }

// NewWithProvider is New with an explicit provider (tests).
func NewWithProvider(d *app.Deps, p Provider) *Module {
	svc := NewService(d.Pool, p)
	d.Push = svc
	slog.Info("push provider", "name", p.Name())
	if _, ok := p.(ReceiptCollector); ok {
		d.Jobs.Every("push.receipts", receiptsEvery, svc.CollectReceipts)
	}
	return &Module{d: d, Svc: svc}
}

func (m *Module) Routes(r chi.Router) {}
