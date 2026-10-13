// Package catalog — monetization catalog and platform settings (money workstream).
//
//	GET   /catalog                       [public] → Catalog (current prices from DB)
//	GET   /admin/catalog                 [admin]  → Catalog (including inactive)
//	PATCH /admin/catalog/services/:code  [ADMIN]  body { price?, durationDays?, active? } → ServiceDef
//	PATCH /admin/catalog/plans/:code     [ADMIN]  body PlanUpdate → PlanDef
//	GET   /admin/settings                [ADMIN]  → PlatformSettings
//	PATCH /admin/settings                [ADMIN]  body SettingsUpdateInput → PlatformSettings
package catalog

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/modules/wallet"
	"github.com/alasgarovnamig/evtap/api/internal/shared"
)

type Module struct{ d *app.Deps }

func New(d *app.Deps) *Module { return &Module{d: d} }

// serviceUpdateSchema
type serviceUpdateBody struct {
	Price        *int  `json:"price" validate:"omitempty,min=0"`
	DurationDays *int  `json:"durationDays" validate:"omitempty,min=0"`
	Active       *bool `json:"active"`
}

// planUpdateSchema
type planUpdateBody struct {
	PriceMonthly          *int  `json:"priceMonthly" validate:"omitempty,min=0"`
	PriceYearly           *int  `json:"priceYearly" validate:"omitempty,min=0"`
	ListingQuota          *int  `json:"listingQuota" validate:"omitempty,min=-1"`
	MonthlyBumps          *int  `json:"monthlyBumps" validate:"omitempty,min=0"`
	MonthlyVipCredits     *int  `json:"monthlyVipCredits" validate:"omitempty,min=0"`
	MonthlyPremiumCredits *int  `json:"monthlyPremiumCredits" validate:"omitempty,min=0"`
	MaxAgents             *int  `json:"maxAgents" validate:"omitempty,min=1"`
	Active                *bool `json:"active"`
}

type topupBonusBody struct {
	MinAmount    *int     `json:"minAmount" validate:"required,min=0"`
	BonusPercent *float64 `json:"bonusPercent" validate:"required,min=0,max=100"`
}

// settingsUpdateSchema
type settingsUpdateBody struct {
	FreeListingsPerMonth     *int              `json:"freeListingsPerMonth" validate:"omitempty,min=0"`
	ListingFee               *int              `json:"listingFee" validate:"omitempty,min=0"`
	ListingLifetimeDays      *int              `json:"listingLifetimeDays" validate:"omitempty,min=1"`
	DailyRentGuestFeePercent *float64          `json:"dailyRentGuestFeePercent" validate:"omitempty,min=0,max=50"`
	DailyRentHostFeePercent  *float64          `json:"dailyRentHostFeePercent" validate:"omitempty,min=0,max=50"`
	PayoutDelayHours         *int              `json:"payoutDelayHours" validate:"omitempty,min=0"`
	FreeCancellationHours    *int              `json:"freeCancellationHours" validate:"omitempty,min=0"`
	TopupBonuses             *[]topupBonusBody `json:"topupBonuses" validate:"omitempty,dive"`
	MinTopup                 *int              `json:"minTopup" validate:"omitempty,min=1"`
	MaxTopup                 *int              `json:"maxTopup" validate:"omitempty,min=1"`
	ModerationEnabled        *bool             `json:"moderationEnabled"`
}

// column is one "SET col = $n" assignment built from a PATCH body.
type column struct {
	name, key string
	val       any
}

func intCol(cols []column, name, key string, v *int) []column {
	if v != nil {
		cols = append(cols, column{name, key, *v})
	}
	return cols
}

func boolCol(cols []column, name, key string, v *bool) []column {
	if v != nil {
		cols = append(cols, column{name, key, *v})
	}
	return cols
}

// update runs `update <table> set … where code = $1` and reports whether the row exists.
func (m *Module) update(ctx context.Context, table, code string, cols []column) (bool, map[string]any, error) {
	data := map[string]any{}
	sets := []string{"updated_at = now()"}
	args := []any{code}
	for _, c := range cols {
		args = append(args, c.val)
		sets = append(sets, c.name+" = $"+strconv.Itoa(len(args)))
		data[c.key] = c.val
	}
	tag, err := m.d.Pool.Exec(ctx, `update `+table+` set `+strings.Join(sets, ", ")+` where code = $1`, args...)
	if err != nil {
		return false, nil, err
	}
	return tag.RowsAffected() > 0, data, nil
}

func (m *Module) Routes(r chi.Router) {
	r.Get("/catalog", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		return m.d.Settings.Catalog(r.Context(), false)
	}))

	r.With(auth.Roles("MODERATOR")).Get("/admin/catalog", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		return m.d.Settings.Catalog(r.Context(), true)
	}))

	r.With(auth.Roles("ADMIN")).Patch("/admin/catalog/services/{code}", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		code := chi.URLParam(r, "code")
		var b serviceUpdateBody
		if err := httpx.Bind(r, &b); err != nil {
			return nil, err
		}
		var cols []column
		cols = intCol(cols, "price", "price", b.Price)
		cols = intCol(cols, "duration_days", "durationDays", b.DurationDays)
		cols = boolCol(cols, "active", "active", b.Active)
		found, data, err := m.update(r.Context(), "services", code, cols)
		if err != nil {
			return nil, err
		}
		if !found {
			return nil, httpx.NotFound("Service")
		}
		m.d.Settings.Invalidate()
		m.d.Audit.Log(r.Context(), &auth.Current(r).ID, "catalog.service.update", "service", &code, data, wallet.ClientIP(r))
		return m.d.Settings.Service(r.Context(), code)
	}))

	r.With(auth.Roles("ADMIN")).Patch("/admin/catalog/plans/{code}", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		code := chi.URLParam(r, "code")
		var b planUpdateBody
		if err := httpx.Bind(r, &b); err != nil {
			return nil, err
		}
		var cols []column
		cols = intCol(cols, "price_monthly", "priceMonthly", b.PriceMonthly)
		cols = intCol(cols, "price_yearly", "priceYearly", b.PriceYearly)
		cols = intCol(cols, "listing_quota", "listingQuota", b.ListingQuota)
		cols = intCol(cols, "monthly_bumps", "monthlyBumps", b.MonthlyBumps)
		cols = intCol(cols, "monthly_vip_credits", "monthlyVipCredits", b.MonthlyVipCredits)
		cols = intCol(cols, "monthly_premium_credits", "monthlyPremiumCredits", b.MonthlyPremiumCredits)
		cols = intCol(cols, "max_agents", "maxAgents", b.MaxAgents)
		cols = boolCol(cols, "active", "active", b.Active)
		found, data, err := m.update(r.Context(), "plans", code, cols)
		if err != nil {
			return nil, err
		}
		if !found {
			return nil, httpx.NotFound("Plan")
		}
		m.d.Settings.Invalidate()
		m.d.Audit.Log(r.Context(), &auth.Current(r).ID, "catalog.plan.update", "plan", &code, data, wallet.ClientIP(r))
		return m.d.Settings.Plan(r.Context(), code)
	}))

	r.With(auth.Roles("ADMIN")).Get("/admin/settings", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		return m.d.Settings.Settings(r.Context())
	}))

	r.With(auth.Roles("ADMIN")).Patch("/admin/settings", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		var b settingsUpdateBody
		if err := httpx.Bind(r, &b); err != nil {
			return nil, err
		}
		cur, err := m.d.Settings.Settings(r.Context())
		if err != nil {
			return nil, err
		}
		minT, maxT := cur.MinTopup, cur.MaxTopup
		if b.MinTopup != nil {
			minT = *b.MinTopup
		}
		if b.MaxTopup != nil {
			maxT = *b.MaxTopup
		}
		if minT > maxT {
			return nil, httpx.BadRequest("VALIDATION_ERROR", "minTopup must not exceed maxTopup")
		}
		patch := settingsPatch(&b)
		next, err := m.d.Settings.UpdateSettings(r.Context(), patch)
		if err != nil {
			return nil, err
		}
		key := "platform"
		m.d.Audit.Log(r.Context(), &auth.Current(r).ID, "settings.update", "settings", &key, patch, wallet.ClientIP(r))
		return next, nil
	}))
}

func settingsPatch(b *settingsUpdateBody) map[string]any {
	p := map[string]any{}
	set := func(k string, ok bool, v any) {
		if ok {
			p[k] = v
		}
	}
	deref := func(v *int) any {
		if v == nil {
			return nil
		}
		return *v
	}
	derefF := func(v *float64) any {
		if v == nil {
			return nil
		}
		return *v
	}
	set("freeListingsPerMonth", b.FreeListingsPerMonth != nil, deref(b.FreeListingsPerMonth))
	set("listingFee", b.ListingFee != nil, deref(b.ListingFee))
	set("listingLifetimeDays", b.ListingLifetimeDays != nil, deref(b.ListingLifetimeDays))
	set("dailyRentGuestFeePercent", b.DailyRentGuestFeePercent != nil, derefF(b.DailyRentGuestFeePercent))
	set("dailyRentHostFeePercent", b.DailyRentHostFeePercent != nil, derefF(b.DailyRentHostFeePercent))
	set("payoutDelayHours", b.PayoutDelayHours != nil, deref(b.PayoutDelayHours))
	set("freeCancellationHours", b.FreeCancellationHours != nil, deref(b.FreeCancellationHours))
	set("minTopup", b.MinTopup != nil, deref(b.MinTopup))
	set("maxTopup", b.MaxTopup != nil, deref(b.MaxTopup))
	if b.ModerationEnabled != nil {
		p["moderationEnabled"] = *b.ModerationEnabled
	}
	if b.TopupBonuses != nil {
		tiers := make([]shared.TopupBonus, 0, len(*b.TopupBonuses))
		for _, t := range *b.TopupBonuses {
			tiers = append(tiers, shared.TopupBonus{MinAmount: *t.MinAmount, BonusPercent: *t.BonusPercent})
		}
		p["topupBonuses"] = tiers
	}
	return p
}
