// Package settings holds platform settings and the monetization catalog (services, bundles, plans) stored in the DB
// (seeded from @evtap/shared defaults), plus listing quota / active subscription lookups shared by many modules.
package settings

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/shared"
)

const key = "platform"

type Service struct {
	pool  *pgxpool.Pool
	mu    sync.Mutex
	cache *snapshot
}

type snapshot struct {
	at       time.Time
	settings shared.PlatformSettings
	services []shared.ServiceDef
	plans    []shared.PlanDef
}

func New(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// EnsureDefaults inserts default settings / services / plans when missing (idempotent). Called on startup and by seed.
func EnsureDefaults(ctx context.Context, q db.Querier) error {
	if _, err := q.Exec(ctx, `insert into settings (key, value) values ($1, $2) on conflict do nothing`, key, shared.Defs.Settings); err != nil {
		return err
	}
	for _, s := range shared.Defs.Services {
		if _, err := q.Exec(ctx, `insert into services (code, promotion_type, duration_days, price, active, sort_order, name, description)
			values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing`,
			s.Code, s.PromotionType, s.DurationDays, s.Price, s.Active, s.SortOrder, s.Name, s.Description); err != nil {
			return err
		}
	}
	for _, p := range shared.Defs.Plans {
		if _, err := q.Exec(ctx, `insert into plans (code, price_monthly, price_yearly, listing_quota, monthly_bumps, monthly_vip_credits,
			monthly_premium_credits, max_agents, features, active, name) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict do nothing`,
			p.Code, p.PriceMonthly, p.PriceYearly, p.ListingQuota, p.MonthlyBumps, p.MonthlyVipCredits, p.MonthlyPremiumCredits,
			p.MaxAgents, p.Features, p.Active, p.Name); err != nil {
			return err
		}
	}
	return nil
}

// Invalidate drops the 30 s cache (call after admin edits).
func (s *Service) Invalidate() {
	s.mu.Lock()
	s.cache = nil
	s.mu.Unlock()
}

func (s *Service) load(ctx context.Context) (*snapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cache != nil && time.Since(s.cache.at) < 30*time.Second {
		return s.cache, nil
	}
	snap := &snapshot{at: time.Now(), settings: shared.Defs.Settings}
	var raw []byte
	err := s.pool.QueryRow(ctx, `select value from settings where key = $1`, key).Scan(&raw)
	if err != nil && !db.IsNoRows(err) {
		return nil, err
	}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &snap.settings) // overlay stored values on defaults
	}
	rows, err := s.pool.Query(ctx, `select code, promotion_type, duration_days, price, active, sort_order, name, description from services order by sort_order`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var d shared.ServiceDef
		if err := rows.Scan(&d.Code, &d.PromotionType, &d.DurationDays, &d.Price, &d.Active, &d.SortOrder, &d.Name, &d.Description); err != nil {
			rows.Close()
			return nil, err
		}
		snap.services = append(snap.services, d)
	}
	rows.Close()
	rows, err = s.pool.Query(ctx, `select code, price_monthly, price_yearly, listing_quota, monthly_bumps, monthly_vip_credits, monthly_premium_credits,
		max_agents, features, active, name from plans order by price_monthly`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var p shared.PlanDef
		if err := rows.Scan(&p.Code, &p.PriceMonthly, &p.PriceYearly, &p.ListingQuota, &p.MonthlyBumps, &p.MonthlyVipCredits,
			&p.MonthlyPremiumCredits, &p.MaxAgents, &p.Features, &p.Active, &p.Name); err != nil {
			rows.Close()
			return nil, err
		}
		snap.plans = append(snap.plans, p)
	}
	rows.Close()
	s.cache = snap
	return snap, nil
}

func (s *Service) Settings(ctx context.Context) (shared.PlatformSettings, error) {
	snap, err := s.load(ctx)
	if err != nil {
		return shared.PlatformSettings{}, err
	}
	return snap.settings, nil
}

// UpdateSettings merges a JSON patch (only provided keys) into the stored settings.
func (s *Service) UpdateSettings(ctx context.Context, patch map[string]any) (shared.PlatformSettings, error) {
	cur, err := s.Settings(ctx)
	if err != nil {
		return cur, err
	}
	b, _ := json.Marshal(cur)
	m := map[string]any{}
	_ = json.Unmarshal(b, &m)
	for k, v := range patch {
		m[k] = v
	}
	if _, err := s.pool.Exec(ctx, `insert into settings (key, value) values ($1,$2) on conflict (key) do update set value = excluded.value, updated_at = now()`, key, m); err != nil {
		return cur, err
	}
	s.Invalidate()
	return s.Settings(ctx)
}

func (s *Service) Services(ctx context.Context, includeInactive bool) ([]shared.ServiceDef, error) {
	snap, err := s.load(ctx)
	if err != nil {
		return nil, err
	}
	out := []shared.ServiceDef{}
	for _, x := range snap.services {
		if includeInactive || x.Active {
			out = append(out, x)
		}
	}
	return out, nil
}

// Service returns a catalog service by code (inactive included — already-paid services must still apply).
func (s *Service) Service(ctx context.Context, code string) (*shared.ServiceDef, error) {
	snap, err := s.load(ctx)
	if err != nil {
		return nil, err
	}
	for i := range snap.services {
		if snap.services[i].Code == code {
			x := snap.services[i]
			return &x, nil
		}
	}
	return nil, nil
}

func (s *Service) Plans(ctx context.Context, includeInactive bool) ([]shared.PlanDef, error) {
	snap, err := s.load(ctx)
	if err != nil {
		return nil, err
	}
	out := []shared.PlanDef{}
	for _, x := range snap.plans {
		if includeInactive || x.Active {
			out = append(out, x)
		}
	}
	return out, nil
}

func (s *Service) Plan(ctx context.Context, code string) (*shared.PlanDef, error) {
	snap, err := s.load(ctx)
	if err != nil {
		return nil, err
	}
	for i := range snap.plans {
		if snap.plans[i].Code == code {
			x := snap.plans[i]
			return &x, nil
		}
	}
	return nil, nil
}

// CatalogSettings is the public subset of PlatformSettings exposed by GET /catalog.
type CatalogSettings struct {
	FreeListingsPerMonth     int                 `json:"freeListingsPerMonth"`
	ListingFee               int                 `json:"listingFee"`
	ListingLifetimeDays      int                 `json:"listingLifetimeDays"`
	DailyRentGuestFeePercent float64             `json:"dailyRentGuestFeePercent"`
	DailyRentHostFeePercent  float64             `json:"dailyRentHostFeePercent"`
	FreeCancellationHours    int                 `json:"freeCancellationHours"`
	TopupBonuses             []shared.TopupBonus `json:"topupBonuses"`
	MinTopup                 int                 `json:"minTopup"`
	MaxTopup                 int                 `json:"maxTopup"`
}

// Catalog is the DTO of GET /catalog (and GET /admin/catalog with inactive items).
type Catalog struct {
	Services []shared.ServiceDef `json:"services"`
	Bundles  []shared.BundleDef  `json:"bundles"`
	Plans    []shared.PlanDef    `json:"plans"`
	Settings CatalogSettings     `json:"settings"`
}

func (s *Service) Catalog(ctx context.Context, includeInactive bool) (*Catalog, error) {
	st, err := s.Settings(ctx)
	if err != nil {
		return nil, err
	}
	svc, err := s.Services(ctx, includeInactive)
	if err != nil {
		return nil, err
	}
	pl, err := s.Plans(ctx, includeInactive)
	if err != nil {
		return nil, err
	}
	return &Catalog{
		Services: svc, Bundles: shared.Defs.Bundles, Plans: pl,
		Settings: CatalogSettings{
			FreeListingsPerMonth: st.FreeListingsPerMonth, ListingFee: st.ListingFee, ListingLifetimeDays: st.ListingLifetimeDays,
			DailyRentGuestFeePercent: st.DailyRentGuestFeePercent, DailyRentHostFeePercent: st.DailyRentHostFeePercent,
			FreeCancellationHours: st.FreeCancellationHours, TopupBonuses: st.TopupBonuses, MinTopup: st.MinTopup, MaxTopup: st.MaxTopup,
		},
	}, nil
}
