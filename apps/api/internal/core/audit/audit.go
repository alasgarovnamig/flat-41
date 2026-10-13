// Package audit records admin / security-relevant actions. Call Log from every admin mutation.
package audit

import (
	"context"
	"log/slog"

	"github.com/alasgarovnamig/evtap/api/internal/db"
)

type Service struct{ db db.Querier }

func New(q db.Querier) *Service { return &Service{db: q} }

// Log writes an audit row; failures are logged, never returned (auditing must not break the action).
func (s *Service) Log(ctx context.Context, actorID *string, action, entity string, entityID *string, data map[string]any, ip *string) {
	if data == nil {
		data = map[string]any{}
	}
	_, err := s.db.Exec(ctx, `insert into audit_logs (actor_id, action, entity, entity_id, data, ip) values ($1,$2,$3,$4,$5,$6)`,
		actorID, action, entity, entityID, data, ip)
	if err != nil {
		slog.Error("audit log", "action", action, "err", err)
	}
}
