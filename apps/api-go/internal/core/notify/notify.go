// Package notify is the single entry point for user notifications:
//
//	notify.Notify(ctx, userID, "LISTING_APPROVED", "Elanınız təsdiqləndi", "...", map[string]any{"listingId": id})
//
// It persists the notification and publishes events.NotificationCreated (→ WebSocket + push).
package notify

import (
	"context"
	"time"

	"github.com/alasgarovnamig/evtap/api/internal/core/events"
	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
)

// AppNotification DTO (types.ts).
type AppNotification struct {
	ID        string         `json:"id"`
	Type      string         `json:"type"`
	Title     string         `json:"title"`
	Body      string         `json:"body"`
	Data      map[string]any `json:"data"`
	ReadAt    *string        `json:"readAt"`
	CreatedAt string         `json:"createdAt"`
}

type Service struct {
	db  db.Querier
	bus *events.Bus
}

func New(q db.Querier, bus *events.Bus) *Service { return &Service{db: q, bus: bus} }

// Notify persists and broadcasts a notification. Pass a transaction as q to make it part of a larger unit of work
// (the event is still published immediately — use NotifyAfterCommit semantics by calling after commit when needed).
func (s *Service) Notify(ctx context.Context, userID, typ, title, body string, data map[string]any) (*AppNotification, error) {
	return s.NotifyQ(ctx, s.db, userID, typ, title, body, data)
}

func (s *Service) NotifyQ(ctx context.Context, q db.Querier, userID, typ, title, body string, data map[string]any) (*AppNotification, error) {
	if data == nil {
		data = map[string]any{}
	}
	var id string
	var created time.Time
	err := q.QueryRow(ctx, `insert into notifications (user_id, type, title, body, data) values ($1,$2,$3,$4,$5) returning id, created_at`,
		userID, typ, title, body, data).Scan(&id, &created)
	if err != nil {
		return nil, err
	}
	n := &AppNotification{ID: id, Type: typ, Title: title, Body: body, Data: data, CreatedAt: httpx.ISO(created)}
	s.bus.Publish(events.NotificationCreated, events.NotificationCreatedEvent{UserID: userID, Notification: n})
	return n, nil
}
