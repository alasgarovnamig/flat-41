// Seeds demo data (idempotent: deterministic ids + ON CONFLICT DO NOTHING, safe to run repeatedly).
// Port of the former apps/api/src/db/seed.ts: admin + moderator, settings/catalog defaults, CMS pages (Markdown,
// az/ru/en), banners, demo users, agencies (incl. a developer), 63 listings, reports, mortgage leads, favorites,
// a saved search and the demo PRO subscription.
//
// Usage: go run ./cmd/seed   (SEED_IMAGES=local → placeholder WebPs generated into UPLOAD_DIR/seed/ and served by the
// API at ${API_PUBLIC_URL}/uploads/seed/<id>.webp — same URL scheme as the TS seed; otherwise Unsplash URLs are hot-linked like before).
package main

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"os"
	"time"

	sq "github.com/Masterminds/squirrel"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/alasgarovnamig/evtap/api/internal/config"
	"github.com/alasgarovnamig/evtap/api/internal/core/settings"
	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/shared"
)

const day = 24 * time.Hour

var psql = sq.StatementBuilder.PlaceholderFormat(sq.Dollar)

// mulberry32 — the same deterministic PRNG as the TS seed (stable demo data between runs).
type prng struct{ state uint32 }

func (p *prng) next() float64 {
	p.state += 0x6d2b79f5
	t := p.state
	t = (t ^ (t >> 15)) * (1 | t)
	t = (t + (t^(t>>7))*(61|t)) ^ t
	return float64(t^(t>>14)) / 4294967296
}

func jsRound(x float64) float64 { return math.Floor(x + 0.5) }

func (p *prng) between(a, b int) int { return int(jsRound(float64(a) + p.next()*float64(b-a))) }
func (p *prng) jitter(v, spread float64) float64 {
	return jsRound((v+(p.next()-0.5)*spread)*1e6) / 1e6
}

// sid: deterministic UUIDs so re-running the seed never duplicates rows.
func sid(kind, n int) string { return fmt.Sprintf("5eed0000-0000-4000-8%d00-%012d", kind, n) }

type seeder struct {
	ctx   context.Context
	pool  *pgxpool.Pool
	cfg   *config.Config
	now   time.Time
	rnd   *prng
	local bool
}

func (s *seeder) daysAgo(d int) time.Time   { return s.now.Add(-time.Duration(d) * day) }
func (s *seeder) daysAhead(d int) time.Time { return s.now.Add(time.Duration(d) * day) }

func (s *seeder) photoURL(id string) (string, string) {
	if s.local {
		base := s.cfg.APIPublicURL + "/uploads/seed/" + id
		return base + ".webp", base + "_t.webp"
	}
	return "https://images.unsplash.com/photo-" + id + "?w=1600&q=80", "https://images.unsplash.com/photo-" + id + "?w=400&q=70"
}

func pick(arr []string, i int) string { return arr[i%len(arr)] }

func imagesFor(prop string, i int) []string {
	n := 3 + i%3
	ids := []string{}
	switch prop {
	case "HOUSE":
		ids = append(ids, pick(photos["house"], i), pick(photos["house"], i+3))
	case "OFFICE":
		ids = append(ids, pick(photos["office"], i), pick(photos["office"], i+1))
	case "LAND":
		ids = append(ids, pick(photos["land"], i), pick(photos["house"], i))
	case "COMMERCIAL":
		ids = append(ids, pick(photos["commercial"], i), pick(photos["office"], i))
	default:
		ids = append(ids, pick(photos["interior"], i), pick(photos["building"], i))
	}
	for k := 0; len(ids) < n; k++ {
		ids = append(ids, pick(photos["interior"], i+2+k*5))
	}
	seen := map[string]bool{}
	out := []string{}
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}

func placeName(sp spec) string {
	if sp.metro != "" {
		if m := shared.MetroByID(sp.metro); m != nil {
			return m.Name.Az + " m."
		}
	}
	if sp.district != "" && sp.city == "baku" {
		if d := shared.DistrictByID(sp.district); d != nil {
			return d.Name.Az
		}
	}
	return shared.CityByID(sp.city).Name.Az
}

func num(f float64) string { return fmt.Sprint(f) }
func iv(p *int) string {
	if p == nil {
		return "undefined"
	}
	return fmt.Sprint(*p)
}
func fv(p *float64) string {
	if p == nil {
		return "undefined"
	}
	return num(*p)
}

func titleOf(sp spec) string {
	if sp.title != "" {
		return sp.title
	}
	place := placeName(sp)
	kind := "mənzil"
	switch sp.b {
	case "NEW":
		kind = "yeni tikili"
	case "SECONDARY":
		kind = "köhnə tikili"
	}
	switch sp.deal {
	case "SALE":
		return fmt.Sprintf("%s otaqlı %s, %s", iv(sp.rooms), kind, place)
	case "RENT_LONG":
		return fmt.Sprintf("Kirayə %s otaqlı mənzil, %s", iv(sp.rooms), place)
	}
	return fmt.Sprintf("Günlük kirayə %s otaqlı mənzil, %s", iv(sp.rooms), place)
}

func descriptionOf(sp spec) string {
	place := placeName(sp)
	city := shared.CityByID(sp.city).Name.Az
	repair := ""
	if sp.repair != "" {
		repair = repairText[sp.repair] + "."
	}
	docs, mort := "", ""
	if sp.doc {
		docs = " Çıxarış var."
	}
	if sp.mortgage {
		mort = " İpoteka ilə almaq mümkündür."
	}
	saleOr := func(sale, rent string) string {
		if sp.deal == "SALE" {
			return sale
		}
		return rent
	}
	switch sp.prop {
	case "HOUSE":
		if sp.deal == "RENT_DAILY" {
			return fmt.Sprintf("%s ərazisində %s otaqlı ev günlük kirayə verilir. Həyətdə manqal, oturacaqlar və uşaqlar üçün oyun yeri var. Ev %s nəfərə qədər qonaq üçün nəzərdə tutulub, təmiz yataq dəstləri və dəsmallar verilir. Giriş 14:00, çıxış 12:00.", city, iv(sp.rooms), iv(sp.guests))
		}
		if sp.deal == "RENT_LONG" {
			return fmt.Sprintf("%s ərazisində %s otaqlı həyət evi uzunmüddətli kirayəyə verilir. Torpaq sahəsi %s sot, ev %s m². %s Ailə üçün ideal seçimdir.", place, iv(sp.rooms), fv(sp.land), num(sp.area), repair)
		}
		return fmt.Sprintf("%s ərazisində %s sot torpaq sahəsində %s otaqlı, %s m² ev satılır. %s%s Bütün kommunikasiyalar qoşulub, həyətdə meyvə ağacları var. Qonşuluq sakit və təhlükəsizdir.", place, fv(sp.land), iv(sp.rooms), num(sp.area), repair, docs)
	case "LAND":
		return fmt.Sprintf("%s ərazisində %s sot torpaq sahəsi satılır. Ərazi düzənlikdir, yol kənarındadır, işıq və su xətti yaxından keçir.%s Fərdi yaşayış evi və ya bağ evi tikmək üçün əlverişlidir.", place, fv(sp.land), docs)
	case "OFFICE":
		return fmt.Sprintf("%s yaxınlığında %s m² ofis sahəsi %s. %s Açıq tipli iş zonası, 2 kabinet, iclas otağı və mətbəx var. Binada mühafizə, lift və parkinq mövcuddur.%s", place, num(sp.area), saleOr("satılır", "icarəyə verilir"), repair, docs)
	case "COMMERCIAL":
		return fmt.Sprintf("%s ərazisində, işlək yol üstündə %s m² qeyri-yaşayış obyekti %s. Mağaza, kafe, aptek və ya ofis üçün uyğundur. %s%s Böyük vitrin şüşələri və ayrıca giriş var.", place, num(sp.area), saleOr("satılır", "icarəyə verilir"), repair, docs)
	case "GARAGE":
		return fmt.Sprintf("%s yaxınlığında mühafizə olunan ərazidə %s m² qaraj satılır. İşıq var, darvaza elektriklidir. Sənədləri qaydasındadır.", place, num(sp.area))
	case "ROOM":
		return fmt.Sprintf("%s yaxınlığında 3 otaqlı mənzildə bir otaq kirayə verilir. Otaq əşyalıdır, Wi-Fi var, kommunal xərclər qiymətə daxildir. Yalnız tələbə qızlara verilir.", place)
	}
	if sp.deal == "RENT_DAILY" {
		return fmt.Sprintf("%s ərazisində %s otaqlı rahat mənzil günlük kirayə verilir. Mənzildə Wi-Fi, kondisioner, mətbəx texnikası, təmiz yataq dəstləri var. %s nəfərə qədər qonaq qəbul edilir. Giriş 14:00, çıxış 12:00. Siqaret çəkmək qadağandır.", place, iv(sp.rooms), iv(sp.guests))
	}
	if sp.deal == "RENT_LONG" {
		return fmt.Sprintf("%s yaxınlığında %s otaqlı, %s m² mənzil uzunmüddətli kirayəyə verilir. %s Mənzil əşyalıdır, bütün məişət texnikası var. Ailəyə verilir, depozit bir aylıq kirayə məbləğidir.", place, iv(sp.rooms), num(sp.area), repair)
	}
	bt := "köhnə tikili"
	if sp.b == "NEW" {
		bt = "yeni tikili"
	}
	return fmt.Sprintf("%s yaxınlığında %s binada %s otaqlı mənzil satılır. Ümumi sahə %s m², %s/%s mərtəbə. %s%s%s Mənzil işıqlı və günəşlidir, yaxınlıqda məktəb, bağça, marketlər və ictimai nəqliyyat var.", place, bt, iv(sp.rooms), num(sp.area), iv(sp.floor), iv(sp.total), repair, docs, mort)
}

func (s *seeder) coordsOf(sp spec) (float64, float64) {
	if sp.metro != "" {
		if m := shared.MetroByID(sp.metro); m != nil {
			lat := s.rnd.jitter(m.Lat, 0.01)
			return lat, s.rnd.jitter(m.Lng, 0.012)
		}
	}
	if d, ok := districtCenter[sp.district]; ok && sp.district != "" {
		lat := s.rnd.jitter(d[0], 0.02)
		return lat, s.rnd.jitter(d[1], 0.025)
	}
	c := shared.CityByID(sp.city)
	lat := s.rnd.jitter(c.Lat, 0.03)
	return lat, s.rnd.jitter(c.Lng, 0.03)
}

func main() {
	if err := run(); err != nil {
		slog.Error("seed failed", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg := config.Load()
	ctx := context.Background()
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := db.Migrate(pool); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	s := &seeder{ctx: ctx, pool: pool, cfg: cfg, now: time.Now(), rnd: &prng{state: 20261013}, local: cfg.SeedImages == "local"}
	if s.local {
		if err := generateLocalImages(cfg.Storage.UploadDir); err != nil {
			return fmt.Errorf("images: %w", err)
		}
		fmt.Printf("✔ placeholder images generated in %s/seed\n", cfg.Storage.UploadDir)
	}
	// Settings & catalog defaults (same as on API start) so the seed works standalone.
	if err := settings.EnsureDefaults(ctx, pool); err != nil {
		return err
	}
	return s.seed()
}

func (s *seeder) exec(sql string, args ...any) error {
	_, err := s.pool.Exec(s.ctx, sql, args...)
	return err
}

func (s *seeder) seed() error {
	ctx, cfg := s.ctx, s.cfg
	// Staff
	adminHash, _ := bcrypt.GenerateFromPassword([]byte(cfg.Admin.Password), 10)
	if err := s.exec(`insert into users (name, email, password_hash, role, is_email_verified) values ('Admin', $1, $2, 'ADMIN', true)
		on conflict do nothing`, cfg.Admin.Email, string(adminHash)); err != nil {
		return fmt.Errorf("admin: %w", err)
	}
	modHash, _ := bcrypt.GenerateFromPassword([]byte("Moder12345!"), 10)
	if err := s.exec(`insert into users (name, email, phone, password_hash, role, is_email_verified, is_phone_verified)
		values ('Moderator', 'moderator@evtap.az', '+994500000001', $1, 'MODERATOR', true, true) on conflict do nothing`, string(modHash)); err != nil {
		return fmt.Errorf("moderator: %w", err)
	}

	// Demo users
	demoHash, _ := bcrypt.GenerateFromPassword([]byte(demoPassword), 10)
	type urow struct{ id, name, phone string }
	users := map[int]urow{}
	for _, u := range demoUsers {
		acct := "INDIVIDUAL"
		if u.business {
			acct = "BUSINESS"
		}
		lastLogin := s.daysAgo(s.rnd.between(0, 3))
		if err := s.exec(`insert into users (id, name, phone, email, password_hash, is_phone_verified, is_email_verified, account_type, created_at, last_login_at)
			values ($1,$2,$3,$4,$5,true,$6,$7,$8,$9) on conflict do nothing`,
			sid(1, u.key+1), u.name, u.phone, u.email, string(demoHash), u.email != nil, acct, s.daysAgo(u.createdDaysAgo), lastLogin); err != nil {
			return fmt.Errorf("user %s: %w", u.name, err)
		}
		var r urow
		if err := s.pool.QueryRow(ctx, `select id, name, phone from users where phone = $1`, u.phone).Scan(&r.id, &r.name, &r.phone); err != nil {
			return err
		}
		users[u.key] = r
		if err := s.exec(`insert into wallets (user_id) values ($1) on conflict do nothing`, r.id); err != nil {
			return err
		}
	}

	// Agencies + members
	agencyOf := map[int]string{}
	for _, a := range demoAgencies {
		if err := s.exec(`insert into agencies (id, owner_id, name, slug, type, verified, city_id, address, phone, email, website, description, created_at)
			values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict do nothing`,
			sid(2, a.n), users[a.ownerKey].id, a.name, a.slug, a.typ, a.verified, a.cityID, a.address, a.phone, a.email, a.website, a.description, s.daysAgo(25)); err != nil {
			return fmt.Errorf("agency %s: %w", a.slug, err)
		}
		var agID string
		if err := s.pool.QueryRow(ctx, `select id from agencies where slug = $1`, a.slug).Scan(&agID); err != nil {
			return err
		}
		members := append([][2]any{{a.ownerKey, "OWNER"}}, func() [][2]any {
			out := [][2]any{}
			for _, m := range a.members {
				out = append(out, [2]any{m, "AGENT"})
			}
			return out
		}()...)
		for _, m := range members {
			key := m[0].(int)
			if err := s.exec(`insert into agency_members (agency_id, user_id, role) values ($1,$2,$3) on conflict do nothing`, agID, users[key].id, m[1]); err != nil {
				return err
			}
			if err := s.exec(`update users set agency_id = $2, account_type = 'BUSINESS', updated_at = now() where id = $1`, users[key].id, agID); err != nil {
				return err
			}
			agencyOf[key] = agID
		}
	}

	// Baku Estate Group runs on a PRO subscription (so its quota/agents limits make sense in the demo).
	bakuEstate := agencyOf[5]
	var hasSub bool
	if err := s.pool.QueryRow(ctx, `select exists(select 1 from subscriptions where agency_id = $1)`, bakuEstate).Scan(&hasSub); err != nil {
		return err
	}
	if !hasSub {
		var pro shared.PlanDef
		for _, p := range shared.Defs.Plans {
			if p.Code == "PRO" {
				pro = p
			}
		}
		if err := s.exec(`insert into subscriptions (user_id, agency_id, plan_code, period, status, auto_renew, current_period_start, current_period_end,
			bumps_left, vip_credits_left, premium_credits_left) values ($1,$2,'PRO','MONTH','ACTIVE',true,$3,$4,$5,$6,$7)`,
			users[5].id, bakuEstate, s.daysAgo(12), s.daysAhead(18), pro.MonthlyBumps-12, pro.MonthlyVipCredits-1, pro.MonthlyPremiumCredits); err != nil {
			return fmt.Errorf("subscription: %w", err)
		}
	}

	// Listings
	lifetime := shared.Defs.Settings.ListingLifetimeDays
	created := 0
	listingIDs := make([]string, len(specs))
	nowMs := float64(s.now.UnixMilli())
	for i, sp := range specs {
		id := sid(3, i+1)
		listingIDs[i] = id
		owner := users[sp.owner]
		status := sp.status
		if status == "" {
			status = "ACTIVE"
		}
		// Spread creation over the last 30 days (expired ones are older).
		var createdAt time.Time
		if status == "EXPIRED" {
			createdAt = s.daysAgo(s.rnd.between(32, 40))
		} else {
			ms := nowMs - (float64(i)/float64(len(specs)))*29*86_400_000 - float64(s.rnd.between(0, 12))*3_600_000
			createdAt = time.UnixMilli(int64(ms))
		}
		var published *time.Time
		if status == "ACTIVE" || status == "EXPIRED" || status == "SOLD" {
			p := createdAt.Add(time.Duration(s.rnd.between(1, 6)) * time.Hour)
			published = &p
		}
		bumpedAt := createdAt
		if published != nil {
			b := published.Add(time.Duration(s.rnd.between(0, 3)) * day)
			if b.After(s.now) {
				b = s.now
			}
			bumpedAt = b
		}
		lat, lng := s.coordsOf(sp)
		promo := []string{}
		if status == "ACTIVE" {
			promo = sp.promo
		}
		has := func(p string) bool {
			for _, x := range promo {
				if x == p {
					return true
				}
			}
			return false
		}
		views := 0
		if status != "PENDING" {
			views = s.rnd.between(40, 1800)
		}
		// values (same evaluation order as the TS object literal → same PRNG sequence)
		var buildingType *string
		if sp.prop == "APARTMENT" && sp.b != "" {
			buildingType = sp2(sp.b)
		}
		var yearBuilt *int
		switch sp.b {
		case "NEW":
			yearBuilt = ip(s.rnd.between(2018, 2025))
		case "SECONDARY":
			yearBuilt = ip(s.rnd.between(1965, 2005))
		}
		var ceiling *float64
		if sp.prop == "APARTMENT" {
			if sp.b == "NEW" {
				ceiling = fp(3.0)
			} else {
				ceiling = fp(2.8)
			}
		}
		var bathrooms *int
		if sp.rooms != nil && *sp.rooms > 0 {
			bathrooms = ip(max(1, *sp.rooms/2))
		}
		phoneViews := int(jsRound(float64(views) * (0.05 + s.rnd.next()*0.1)))
		until := func(p string) *time.Time {
			if !has(p) {
				return nil
			}
			t := s.daysAhead(s.rnd.between(2, 7))
			return &t
		}
		vip, premium, hl, urgent := until("vip"), until("premium"), until("hl"), until("urgent")
		city := shared.CityByID(sp.city)
		address := city.Name.Az
		if sp.district != "" {
			address = shared.DistrictByID(sp.district).Name.Az + ", " + placeName(sp)
		}
		cur := sp.cur
		if cur == "" {
			cur = "AZN"
		}
		amen := []string{}
		seen := map[string]bool{}
		for _, a := range sp.am {
			if !seen[a] {
				seen[a] = true
				amen = append(amen, a)
			}
		}
		var minNights *int
		var checkIn, checkOut, rules *string
		if sp.deal == "RENT_DAILY" {
			if sp.prop == "HOUSE" {
				minNights = ip(2)
			} else {
				minNights = ip(1)
			}
			checkIn, checkOut = sp2("14:00"), sp2("12:00")
			rules = sp2("Siqaret çəkmək qadağandır. Səs-küy 23:00-dan sonra qadağandır. Ev heyvanları ilə razılaşma əsasında.")
		}
		var rejection *string
		if status == "REJECTED" {
			rejection = sp2("Şəkillər əmlaka aid deyil, real şəkillər yükləyin.")
		}
		var expires *time.Time
		if published != nil {
			e := published.Add(time.Duration(lifetime) * day)
			expires = &e
		}
		var agencyID *string
		if a, ok := agencyOf[sp.owner]; ok {
			agencyID = &a
		}
		values := map[string]any{
			"id": id, "owner_id": owner.id, "agency_id": agencyID, "deal_type": sp.deal, "property_type": sp.prop, "building_type": buildingType,
			"title": titleOf(sp), "description": descriptionOf(sp), "price": sp.price, "currency": cur, "price_period": shared.PricePeriodFor(sp.deal),
			"country": city.Country, "city_id": sp.city, "district_id": nilIfEmpty(sp.district), "metro_id": nilIfEmpty(sp.metro), "address": address,
			"lat": lat, "lng": lng, "area": sp.area, "land_area": sp.land, "rooms": sp.rooms, "bathrooms": bathrooms, "floor": sp.floor,
			"total_floors": sp.total, "year_built": yearBuilt, "ceiling_height": ceiling, "repair": nilIfEmpty(sp.repair), "has_document": sp.doc,
			"mortgage_available": sp.mortgage, "amenities": amen, "max_guests": sp.guests, "min_nights": minNights, "check_in_time": checkIn,
			"check_out_time": checkOut, "house_rules": rules, "contact_name": owner.name, "contact_phone": owner.phone, "status": status,
			"rejection_reason": rejection, "is_verified": sp.verified, "is_free_quota": true, "views": views, "phone_views": phoneViews,
			"bumped_at": bumpedAt, "vip_until": vip, "premium_until": premium, "highlight_until": hl, "urgent_until": urgent,
			"published_at": published, "expires_at": expires, "created_at": createdAt, "updated_at": createdAt,
		}
		sqlStr, args, err := psql.Insert("listings").SetMap(values).Suffix("on conflict do nothing returning id").ToSql()
		if err != nil {
			return err
		}
		rows, err := s.pool.Query(ctx, sqlStr, args...)
		if err != nil {
			return fmt.Errorf("listing %d: %w", i, err)
		}
		inserted := rows.Next()
		rows.Close()
		if err := rows.Err(); err != nil {
			return fmt.Errorf("listing %d: %w", i, err)
		}
		if !inserted {
			continue
		}
		created++
		for order, pid := range imagesFor(sp.prop, i) {
			u, t := s.photoURL(pid)
			if err := s.exec(`insert into listing_images (listing_id, url, thumb_url, "order") values ($1,$2,$3,$4)`, id, u, t, order); err != nil {
				return err
			}
		}
		for _, p := range promo {
			typ := map[string]string{"vip": "VIP", "premium": "PREMIUM", "urgent": "URGENT", "hl": "HIGHLIGHT"}[p]
			ends := map[string]*time.Time{"vip": vip, "premium": premium, "urgent": urgent, "hl": hl}[p]
			if err := s.exec(`insert into listing_promotions (listing_id, type, service_code, starts_at, ends_at, source) values ($1,$2,$3,$4,$5,'ADMIN')`,
				id, typ, typ+"_7", ends.Add(-7*day), *ends); err != nil {
				return err
			}
		}
		// Daily view stats since publication (≤ 30 days) so owner/agency charts have data.
		if published != nil && views > 0 {
			days := int(math.Min(30, math.Max(1, math.Ceil(float64(s.now.Sub(*published).Milliseconds())/86_400_000))))
			for k := 0; k < days; k++ {
				v := int(math.Max(0, jsRound(float64(views)/float64(days)*(0.5+s.rnd.next()))))
				if err := s.exec(`insert into listing_daily_stats (listing_id, date, views, phone_views) values ($1,$2::date,$3,$4) on conflict do nothing`,
					id, s.daysAgo(k).UTC().Format("2006-01-02"), v, int(jsRound(float64(v)*0.08))); err != nil {
					return err
				}
			}
		}
		if sp.deal == "RENT_DAILY" && status == "ACTIVE" && i%2 == 0 {
			for _, d := range []int{5, 6, 12, 13, 14} {
				if err := s.exec(`insert into listing_blocked_dates (listing_id, date) values ($1,$2::date) on conflict do nothing`,
					id, s.daysAhead(d).UTC().Format("2006-01-02")); err != nil {
					return err
				}
			}
		}
	}

	// Favorites
	for _, f := range favs {
		if err := s.exec(`insert into favorites (user_id, listing_id) values ($1,$2) on conflict do nothing`, users[f[0]].id, listingIDs[f[1]]); err != nil {
			return err
		}
	}
	if err := s.exec(`update listings l set favorites_count = (select count(*) from favorites f where f.listing_id = l.id) where l.id = any($1::uuid[])`, listingIDs); err != nil {
		return err
	}

	// Saved search
	var hasSaved bool
	if err := s.pool.QueryRow(ctx, `select exists(select 1 from saved_searches where user_id = $1)`, users[0].id).Scan(&hasSaved); err != nil {
		return err
	}
	if !hasSaved {
		q := map[string]any{"dealType": "SALE", "cityId": "baku", "districtId": []string{"baku-narimanov"}, "rooms": []int{2, 3}, "priceMax": 300000}
		if err := s.exec(`insert into saved_searches (user_id, name, query, notify, last_checked_at) values ($1,$2,$3,true,$4)`,
			users[0].id, "Nərimanovda 2-3 otaqlı", q, s.daysAgo(1)); err != nil {
			return err
		}
	}

	// Reports
	for _, r := range reports {
		var reporter *string
		if r.by != nil {
			id := users[*r.by].id
			reporter = &id
		}
		if err := s.exec(`insert into listing_reports (id, listing_id, reporter_id, reason, comment, created_at) values ($1,$2,$3,$4,$5,$6) on conflict do nothing`,
			sid(4, r.n), listingIDs[r.l], reporter, r.reason, r.comment, s.daysAgo(r.n)); err != nil {
			return err
		}
	}

	// Mortgage leads
	for _, m := range leads {
		var lid *string
		if m.l != nil {
			lid = &listingIDs[*m.l]
		}
		if err := s.exec(`insert into mortgage_leads (id, name, phone, listing_id, price, down_payment, term_years, bank_code, status, created_at)
			values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict do nothing`,
			sid(5, m.n), m.name, m.phone, lid, m.price, m.down, m.term, m.bank, m.status, s.daysAgo(m.n*3)); err != nil {
			return err
		}
	}

	// CMS pages & banners
	for _, p := range pages {
		if err := s.exec(`insert into cms_pages (slug, title, body) values ($1,$2,$3) on conflict do nothing`, p.slug, p.title, p.body); err != nil {
			return err
		}
	}
	for _, b := range banners {
		img, _ := s.photoURL(b.photoID)
		impressions, clicks := s.rnd.between(500, 5000), s.rnd.between(10, 200)
		if err := s.exec(`insert into banners (id, placement, title, image_url, link_url, sort_order, active, starts_at, ends_at, impressions, clicks)
			values ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10) on conflict do nothing`,
			sid(6, b.n), b.placement, b.title, img, b.linkURL, b.sortOrder, s.daysAgo(10), s.daysAhead(60), impressions, clicks); err != nil {
			return err
		}
	}

	var active int
	if err := s.pool.QueryRow(ctx, `select count(*)::int from listings where status = 'ACTIVE'`).Scan(&active); err != nil {
		return err
	}
	fmt.Printf("✔ admin: %s / %s\n", cfg.Admin.Email, cfg.Admin.Password)
	fmt.Println("✔ moderator: moderator@evtap.az / Moder12345!")
	fmt.Printf("✔ demo users: %d (password %s, or OTP login by phone), agencies: %d\n", len(demoUsers), demoPassword, len(demoAgencies))
	fmt.Printf("✔ listings: %d new (%d demo total, %d active in DB)\n", created, len(specs), active)
	return nil
}

func sp2(s string) *string { return &s }

func nilIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
