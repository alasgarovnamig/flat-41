// Package messaging: buyer ↔ seller conversations per listing (/conversations*). Every new message publishes
// events.MessageCreated (→ realtime `message:new`) and a throttled NEW_MESSAGE notification (→ `notification:new` + push);
// read receipts publish events.ConversationRead (→ `conversation:read`).
package messaging

import (
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
)

type Module struct {
	d   *app.Deps
	Svc *Service
}

func New(d *app.Deps) *Module {
	return &Module{d: d, Svc: NewService(d.Pool, d.Bus, d.Notify)}
}

// startBody mirrors startConversationSchema: { listingId: uuid, message: trim().min(1).max(2000) }.
type startBody struct {
	ListingID string `json:"listingId" validate:"required,uuid"`
	Message   string `json:"message" validate:"required,min=1,max=2000"`
}

func (b *startBody) Normalize() { b.Message = strings.TrimSpace(b.Message) }

// sendBody mirrors sendMessageSchema: { body: trim().min(1).max(2000) }.
type sendBody struct {
	Body string `json:"body" validate:"required,min=1,max=2000"`
}

func (b *sendBody) Normalize() { b.Body = strings.TrimSpace(b.Body) }

func (m *Module) Routes(r chi.Router) {
	r.Route("/conversations", func(r chi.Router) {
		r.Use(auth.Required)
		r.Get("/", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			pa, err := httpx.Pagination(r, 20, 100)
			if err != nil {
				return nil, err
			}
			return m.Svc.List(r.Context(), auth.Current(r).ID, pa)
		}))
		r.Post("/", httpx.HS(http.StatusCreated, func(w http.ResponseWriter, r *http.Request) (any, error) {
			var b startBody
			if err := httpx.Bind(r, &b); err != nil {
				return nil, err
			}
			return m.Svc.Start(r.Context(), auth.Current(r).ID, strings.ToLower(b.ListingID), b.Message)
		}))
		r.Get("/unread-count", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			n, err := m.Svc.UnreadCount(r.Context(), auth.Current(r).ID)
			if err != nil {
				return nil, err
			}
			return map[string]int{"count": n}, nil
		}))
		r.Get("/{id}", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			id, err := httpx.UUIDParam(r, "id")
			if err != nil {
				return nil, err
			}
			return m.Svc.Get(r.Context(), auth.Current(r).ID, id)
		}))
		r.Get("/{id}/messages", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			id, err := httpx.UUIDParam(r, "id")
			if err != nil {
				return nil, err
			}
			before, limit, err := messageListQuery(r)
			if err != nil {
				return nil, err
			}
			return m.Svc.Messages(r.Context(), auth.Current(r).ID, id, before, limit)
		}))
		r.Post("/{id}/messages", httpx.HS(http.StatusCreated, func(w http.ResponseWriter, r *http.Request) (any, error) {
			id, err := httpx.UUIDParam(r, "id")
			if err != nil {
				return nil, err
			}
			var b sendBody
			if err := httpx.Bind(r, &b); err != nil {
				return nil, err
			}
			return m.Svc.Send(r.Context(), auth.Current(r).ID, id, b.Body)
		}))
		r.Post("/{id}/read", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			id, err := httpx.UUIDParam(r, "id")
			if err != nil {
				return nil, err
			}
			if err := m.Svc.MarkRead(r.Context(), auth.Current(r).ID, id); err != nil {
				return nil, err
			}
			return httpx.OK, nil
		}))
	})
}

// messageListQuery mirrors messageListQuerySchema: { before?: uuid, limit: int 1..100 = 50 }.
func messageListQuery(r *http.Request) (*string, int, error) {
	q := httpx.Q(r)
	before := q.Str("before")
	limit := 50
	if v := q.Int("limit"); v != nil {
		limit = *v
		if limit < 1 || limit > 100 {
			q.Fail("limit: expected 1..100")
		}
	}
	if before != nil {
		if !isUUID(*before) {
			q.Fail("before: Invalid UUID")
		} else {
			lower := strings.ToLower(*before)
			before = &lower
		}
	}
	return before, limit, q.Err()
}

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// isUUID: canonical 8-4-4-4-12 hex form only (like zod's uuid()).
func isUUID(s string) bool { return uuidRe.MatchString(s) }
