package app

import (
	"context"
	"errors"
	"sync"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alasgarovnamig/evtap/mockbank/internal/config"
)

// MerchantService reads merchants (seeded from the MERCHANTS env).
type MerchantService struct {
	db    *pgxpool.Pool
	mu    sync.RWMutex
	cache map[string]*Merchant
}

// NewMerchantService creates the service.
func NewMerchantService(db *pgxpool.Pool) *MerchantService {
	return &MerchantService{db: db, cache: map[string]*Merchant{}}
}

// Seed upserts merchants from the env (secret / name changes are applied on boot).
func (s *MerchantService) Seed(ctx context.Context, seeds []config.MerchantSeed) error {
	for _, m := range seeds {
		_, err := s.db.Exec(ctx, `INSERT INTO merchants (id, name, secret) VALUES ($1, $2, $3)
			ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, secret = EXCLUDED.secret`, m.ID, m.Name, m.Secret)
		if err != nil {
			return err
		}
	}
	s.mu.Lock()
	s.cache = map[string]*Merchant{}
	s.mu.Unlock()
	return nil
}

// Get returns a merchant by id (nil when unknown).
func (s *MerchantService) Get(ctx context.Context, id string) (*Merchant, error) {
	s.mu.RLock()
	m, ok := s.cache[id]
	s.mu.RUnlock()
	if ok {
		return m, nil
	}
	var mm Merchant
	err := s.db.QueryRow(ctx, `SELECT id, name, secret, created_at FROM merchants WHERE id = $1`, id).
		Scan(&mm.ID, &mm.Name, &mm.Secret, &mm.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.cache[id] = &mm
	s.mu.Unlock()
	return &mm, nil
}

// List returns all merchants with order / token counters.
func (s *MerchantService) List(ctx context.Context) ([]MerchantStats, error) {
	rows, err := s.db.Query(ctx, `
      SELECT m.id, m.name, m.secret, m.created_at,
        (SELECT count(*) FROM orders o WHERE o.merchant_id = m.id)::int AS order_count,
        (SELECT count(*) FROM orders o WHERE o.merchant_id = m.id AND o.status IN ('APPROVED','REFUNDED','PARTIALLY_REFUNDED'))::int AS approved_count,
        (SELECT count(*) FROM card_tokens t WHERE t.merchant_id = m.id)::int AS token_count
      FROM merchants m ORDER BY m.created_at, m.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MerchantStats
	for rows.Next() {
		var m MerchantStats
		if err := rows.Scan(&m.ID, &m.Name, &m.Secret, &m.CreatedAt, &m.OrderCount, &m.ApprovedCount, &m.TokenCount); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}
