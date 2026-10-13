// Package notifications: the user's inbox (/notifications*), admin broadcast, and push delivery for every
// events.NotificationCreated (unless SkipPush). Creating notifications is core: d.Notify.Notify(...).
package notifications

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/core/events"
	"github.com/alasgarovnamig/evtap/api/internal/core/notify"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
)

// BroadcastBatch is the number of users inserted (and pushed) per round trip.
var BroadcastBatch = 1000

const pushTimeout = 30 * time.Second

type Module struct{ d *app.Deps }

func New(d *app.Deps) *Module {
	m := &Module{d: d}
	d.Bus.Subscribe(events.NotificationCreated, m.onNotificationCreated)
	return m
}

// PushData is the deep-link friendly push data: { ...notification.data, type, notificationId }.
func PushData(n *notify.AppNotification) map[string]any {
	out := make(map[string]any, len(n.Data)+2)
	for k, v := range n.Data {
		out[k] = v
	}
	out["type"] = n.Type
	out["notificationId"] = n.ID
	return out
}

func asNotification(v any) *notify.AppNotification {
	switch n := v.(type) {
	case *notify.AppNotification:
		return n
	case notify.AppNotification:
		return &n
	}
	return nil
}

// onNotificationCreated: every notification goes to the user's devices. Broadcasts set SkipPush and push in bulk.
func (m *Module) onNotificationCreated(payload any) {
	e, ok := payload.(events.NotificationCreatedEvent)
	if !ok || e.SkipPush || m.d.Push == nil {
		return
	}
	n := asNotification(e.Notification)
	if n == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), pushTimeout)
	defer cancel()
	p := app.PushPayload{Title: n.Title, Body: n.Body, Data: PushData(n)}
	if _, err := m.d.Push.SendToUsers(ctx, []string{e.UserID}, func(string) app.PushPayload { return p }); err != nil {
		slog.Warn("push for notification failed", "notification", n.ID, "err", err)
	}
}

const notifCols = `id::text, type, title, body, data, read_at, created_at`

func scanNotification(row interface{ Scan(...any) error }) (notify.AppNotification, error) {
	var n notify.AppNotification
	var readAt *time.Time
	var created time.Time
	if err := row.Scan(&n.ID, &n.Type, &n.Title, &n.Body, &n.Data, &readAt, &created); err != nil {
		return n, err
	}
	if n.Data == nil {
		n.Data = map[string]any{}
	}
	n.ReadAt, n.CreatedAt = httpx.ISOPtr(readAt), httpx.ISO(created)
	return n, nil
}

// broadcastBody mirrors broadcastSchema.
type broadcastBody struct {
	Title    string `json:"title" validate:"required,min=1,max=120"`
	Body     string `json:"body" validate:"required,min=1,max=1000"`
	Audience string `json:"audience" validate:"required,oneof=ALL BUSINESS INDIVIDUAL"`
}

func (m *Module) Routes(r chi.Router) {
	r.Route("/notifications", func(r chi.Router) {
		r.Use(auth.Required)
		r.Get("/", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			pa, err := httpx.Pagination(r, 20, 100)
			if err != nil {
				return nil, err
			}
			return m.list(r.Context(), auth.Current(r).ID, pa)
		}))
		// declared before /{id}/read; chi matches static segments first anyway
		r.Post("/read-all", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			if _, err := m.d.Pool.Exec(r.Context(), `update notifications set read_at = now() where user_id = $1 and read_at is null`, auth.Current(r).ID); err != nil {
				return nil, err
			}
			return httpx.OK, nil
		}))
		r.Post("/{id}/read", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			id, err := httpx.UUIDParam(r, "id")
			if err != nil {
				return nil, err
			}
			var exists bool
			if err := m.d.Pool.QueryRow(r.Context(), `with u as (update notifications set read_at = coalesce(read_at, now())
				where id = $1 and user_id = $2 returning 1) select exists(select 1 from u)`, id, auth.Current(r).ID).Scan(&exists); err != nil {
				return nil, err
			}
			if !exists {
				return nil, httpx.NotFound("Notification")
			}
			return httpx.OK, nil
		}))
	})
	r.With(auth.Roles("ADMIN")).Post("/admin/notifications/broadcast", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		var b broadcastBody
		if err := httpx.Bind(r, &b); err != nil {
			return nil, err
		}
		actor := auth.Current(r).ID
		sent, err := m.Broadcast(r.Context(), b.Title, b.Body, b.Audience)
		if err != nil {
			return nil, err
		}
		ip := clientIP(r)
		m.d.Audit.Log(r.Context(), &actor, "notification.broadcast", "notification", nil,
			map[string]any{"title": b.Title, "audience": b.Audience, "sent": sent}, ip)
		return map[string]int{"sent": sent}, nil
	}))
}

func (m *Module) list(ctx context.Context, userID string, pa httpx.PageArgs) (httpx.Paginated[notify.AppNotification], error) {
	var total int
	if err := m.d.Pool.QueryRow(ctx, `select count(*) from notifications where user_id = $1`, userID).Scan(&total); err != nil {
		return httpx.Paginated[notify.AppNotification]{}, err
	}
	rows, err := m.d.Pool.Query(ctx, `select `+notifCols+` from notifications where user_id = $1
		order by created_at desc, id desc limit $2 offset $3`, userID, pa.Limit, pa.Offset)
	if err != nil {
		return httpx.Paginated[notify.AppNotification]{}, err
	}
	defer rows.Close()
	var items []notify.AppNotification
	for rows.Next() {
		n, err := scanNotification(rows)
		if err != nil {
			return httpx.Paginated[notify.AppNotification]{}, err
		}
		items = append(items, n)
	}
	if err := rows.Err(); err != nil {
		return httpx.Paginated[notify.AppNotification]{}, err
	}
	return httpx.NewPage(items, total, pa.Page, pa.PageSize), nil
}

// Broadcast sends a SYSTEM notification to every ACTIVE user of the audience (ALL | BUSINESS | INDIVIDUAL):
// one multi-row insert per batch of users (keyset pagination by id), realtime per user (SkipPush), and one bulk
// push call per batch instead of one per user.
func (m *Module) Broadcast(ctx context.Context, title, body, audience string) (int, error) {
	var accountType *string
	if audience != "ALL" {
		accountType = &audience
	}
	cursor := "00000000-0000-0000-0000-000000000000"
	sent := 0
	for {
		rows, err := m.d.Pool.Query(ctx, `with batch as (
				select id from users where status = 'ACTIVE' and ($1::text is null or account_type = $1) and id > $2::uuid
				order by id limit $3
			)
			insert into notifications (user_id, type, title, body, data)
			select id, 'SYSTEM', $4, $5, '{"broadcast": true}'::jsonb from batch order by id
			returning user_id::text, `+notifCols, accountType, cursor, BroadcastBatch, title, body)
		if err != nil {
			return sent, err
		}
		byUser := map[string]*notify.AppNotification{}
		var userIDs []string
		for rows.Next() {
			var userID string
			var n notify.AppNotification
			var readAt *time.Time
			var created time.Time
			if err := rows.Scan(&userID, &n.ID, &n.Type, &n.Title, &n.Body, &n.Data, &readAt, &created); err != nil {
				rows.Close()
				return sent, err
			}
			n.ReadAt, n.CreatedAt = httpx.ISOPtr(readAt), httpx.ISO(created)
			byUser[userID] = &n
			userIDs = append(userIDs, userID)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return sent, err
		}
		if len(userIDs) == 0 {
			break
		}
		sent += len(userIDs)
		for _, uid := range userIDs {
			if uid > cursor {
				cursor = uid
			}
			m.d.Bus.Publish(events.NotificationCreated, events.NotificationCreatedEvent{UserID: uid, Notification: byUser[uid], SkipPush: true})
		}
		if m.d.Push != nil {
			if _, err := m.d.Push.SendToUsers(ctx, userIDs, func(uid string) app.PushPayload {
				n := byUser[uid]
				return app.PushPayload{Title: n.Title, Body: n.Body, Data: PushData(n)}
			}); err != nil {
				slog.Warn("broadcast push batch failed", "err", err)
			}
		}
		if len(userIDs) < BroadcastBatch {
			break
		}
	}
	return sent, nil
}

// clientIP: chi's RealIP middleware has already resolved X-Forwarded-For / X-Real-IP into RemoteAddr.
func clientIP(r *http.Request) *string {
	ip := r.RemoteAddr
	if i := strings.LastIndex(ip, ":"); i > 0 && !strings.Contains(ip[i:], "]") {
		ip = ip[:i]
	}
	ip = strings.Trim(ip, "[]")
	if ip == "" {
		return nil
	}
	return &ip
}
