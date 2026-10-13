package promotions

import (
	"context"
	"strconv"
	"time"

	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
)

// Minimal listing mappers needed by the money modules (apply-credit response, booking cards) — a port of
// apps/api/src/modules/promotions/listing-view.ts.
// TODO: delegate to the listings module's mappers once the marketplace workstream exposes them.

// Cover is the first image (thumbnail) of a listing and its image count.
type Cover struct {
	CoverURL    *string
	ImagesCount int
}

// ListingCovers returns cover thumbnails / image counts keyed by listing id.
func ListingCovers(ctx context.Context, q db.Querier, ids []string) (map[string]Cover, error) {
	out := map[string]Cover{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `select listing_id, thumb_url from listing_images where listing_id = any($1::uuid[]) order by listing_id, "order"`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id, thumb string
		if err := rows.Scan(&id, &thumb); err != nil {
			return nil, err
		}
		if c, ok := out[id]; ok {
			c.ImagesCount++
			out[id] = c
		} else {
			t := thumb
			out[id] = Cover{CoverURL: &t, ImagesCount: 1}
		}
	}
	return out, rows.Err()
}

// F32 converts a Postgres real to float64 using its shortest decimal form (72.3, not 72.30000305175781),
// matching what node-postgres returned.
func F32(v float32) float64 {
	f, _ := strconv.ParseFloat(strconv.FormatFloat(float64(v), 'g', -1, 32), 64)
	return f
}

func f32p(v *float32) *float64 {
	if v == nil {
		return nil
	}
	f := F32(*v)
	return &f
}

// ListingRow holds the listing columns the money modules need.
type ListingRow struct {
	ID, OwnerID                                         string
	AgencyID                                            *string
	DealType, PropertyType                              string
	BuildingType                                        *string
	Title                                               string
	Price                                               int64
	Currency, PricePeriod, Country, CityID              string
	DistrictID, MetroID, Address                        *string
	Lat, Lng                                            *float64
	Area                                                float32
	LandArea                                            *float32
	Rooms, Floor, TotalFloors                           *int
	MaxGuests, MinNights                                *int
	CheckInTime                                         *string
	Status                                              string
	RejectionReason                                     *string
	IsVerified, HasDocument, MortgageAvailable          bool
	Views, PhoneViews, FavoritesCount                   int
	RatingAvg                                           *float32
	BumpedAt                                            time.Time
	VipUntil, PremiumUntil, HighlightUntil, UrgentUntil *time.Time
	AutoBumpUntil                                       *time.Time
	PublishedAt, ExpiresAt                              *time.Time
	CreatedAt                                           time.Time
}

// ListingColumns selects ListingRow fields in ScanListing order.
const ListingColumns = `id, owner_id, agency_id, deal_type, property_type, building_type, title, price, currency, price_period, country, city_id,
	district_id, metro_id, address, lat, lng, area, land_area, rooms, floor, total_floors, max_guests, min_nights, check_in_time, status,
	rejection_reason, is_verified, has_document, mortgage_available, views, phone_views, favorites_count, rating_avg, bumped_at,
	vip_until, premium_until, highlight_until, urgent_until, auto_bump_until, published_at, expires_at, created_at`

// ScanListing scans a row selected with ListingColumns.
func ScanListing(row interface{ Scan(...any) error }) (*ListingRow, error) {
	var l ListingRow
	err := row.Scan(&l.ID, &l.OwnerID, &l.AgencyID, &l.DealType, &l.PropertyType, &l.BuildingType, &l.Title, &l.Price, &l.Currency, &l.PricePeriod,
		&l.Country, &l.CityID, &l.DistrictID, &l.MetroID, &l.Address, &l.Lat, &l.Lng, &l.Area, &l.LandArea, &l.Rooms, &l.Floor, &l.TotalFloors,
		&l.MaxGuests, &l.MinNights, &l.CheckInTime, &l.Status, &l.RejectionReason, &l.IsVerified, &l.HasDocument, &l.MortgageAvailable,
		&l.Views, &l.PhoneViews, &l.FavoritesCount, &l.RatingAvg, &l.BumpedAt, &l.VipUntil, &l.PremiumUntil, &l.HighlightUntil, &l.UrgentUntil,
		&l.AutoBumpUntil, &l.PublishedAt, &l.ExpiresAt, &l.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &l, nil
}

// GetListing loads a listing (optionally "for update"). Returns nil when it does not exist.
func GetListing(ctx context.Context, q db.Querier, id string, forUpdate bool) (*ListingRow, error) {
	sql := `select ` + ListingColumns + ` from listings where id = $1`
	if forUpdate {
		sql += ` for update`
	}
	l, err := ScanListing(q.QueryRow(ctx, sql, id))
	if db.IsNoRows(err) {
		return nil, nil
	}
	return l, err
}

// ListingCard DTO (types.ts).
type ListingCard struct {
	ID                string   `json:"id"`
	Title             string   `json:"title"`
	DealType          string   `json:"dealType"`
	PropertyType      string   `json:"propertyType"`
	BuildingType      *string  `json:"buildingType"`
	Price             int64    `json:"price"`
	Currency          string   `json:"currency"`
	PricePeriod       string   `json:"pricePeriod"`
	Country           string   `json:"country"`
	CityID            string   `json:"cityId"`
	DistrictID        *string  `json:"districtId"`
	MetroID           *string  `json:"metroId"`
	Address           *string  `json:"address"`
	Area              float64  `json:"area"`
	LandArea          *float64 `json:"landArea"`
	Rooms             *int     `json:"rooms"`
	Floor             *int     `json:"floor"`
	TotalFloors       *int     `json:"totalFloors"`
	CoverURL          *string  `json:"coverUrl"`
	ImagesCount       int      `json:"imagesCount"`
	Lat               *float64 `json:"lat"`
	Lng               *float64 `json:"lng"`
	IsVip             bool     `json:"isVip"`
	IsPremium         bool     `json:"isPremium"`
	IsHighlighted     bool     `json:"isHighlighted"`
	IsUrgent          bool     `json:"isUrgent"`
	IsVerified        bool     `json:"isVerified"`
	HasDocument       bool     `json:"hasDocument"`
	MortgageAvailable bool     `json:"mortgageAvailable"`
	IsBusiness        bool     `json:"isBusiness"`
	Rating            *float64 `json:"rating"`
	Status            string   `json:"status"`
	BumpedAt          string   `json:"bumpedAt"`
	PublishedAt       *string  `json:"publishedAt"`
	CreatedAt         string   `json:"createdAt"`
}

// ActivePromotion DTO (types.ts).
type ActivePromotion struct {
	ID          string  `json:"id"`
	Type        string  `json:"type"`
	ServiceCode string  `json:"serviceCode"`
	StartsAt    string  `json:"startsAt"`
	EndsAt      *string `json:"endsAt"`
}

// MyListing DTO (types.ts).
type MyListing struct {
	ListingCard
	Views           int               `json:"views"`
	PhoneViews      int               `json:"phoneViews"`
	FavoritesCount  int               `json:"favoritesCount"`
	ExpiresAt       *string           `json:"expiresAt"`
	RejectionReason *string           `json:"rejectionReason"`
	Promotions      []ActivePromotion `json:"promotions"`
	RequiresPayment bool              `json:"requiresPayment"`
}

func after(t *time.Time, now time.Time) bool { return t != nil && t.After(now) }

// ToListingCard maps a listing row to the ListingCard DTO.
func ToListingCard(ctx context.Context, q db.Querier, l *ListingRow) (*ListingCard, error) {
	now := time.Now()
	covers, err := ListingCovers(ctx, q, []string{l.ID})
	if err != nil {
		return nil, err
	}
	var accountType string
	if err := q.QueryRow(ctx, `select account_type from users where id = $1`, l.OwnerID).Scan(&accountType); err != nil && !db.IsNoRows(err) {
		return nil, err
	}
	c := covers[l.ID]
	return &ListingCard{
		ID: l.ID, Title: l.Title, DealType: l.DealType, PropertyType: l.PropertyType, BuildingType: l.BuildingType, Price: l.Price, Currency: l.Currency,
		PricePeriod: l.PricePeriod, Country: l.Country, CityID: l.CityID, DistrictID: l.DistrictID, MetroID: l.MetroID, Address: l.Address,
		Area: F32(l.Area), LandArea: f32p(l.LandArea), Rooms: l.Rooms, Floor: l.Floor, TotalFloors: l.TotalFloors,
		CoverURL: c.CoverURL, ImagesCount: c.ImagesCount, Lat: l.Lat, Lng: l.Lng,
		IsVip: after(l.VipUntil, now), IsPremium: after(l.PremiumUntil, now), IsHighlighted: after(l.HighlightUntil, now), IsUrgent: after(l.UrgentUntil, now),
		IsVerified: l.IsVerified, HasDocument: l.HasDocument, MortgageAvailable: l.MortgageAvailable,
		IsBusiness: l.AgencyID != nil || accountType == "BUSINESS", Rating: f32p(l.RatingAvg), Status: l.Status,
		BumpedAt: httpx.ISO(l.BumpedAt), PublishedAt: httpx.ISOPtr(l.PublishedAt), CreatedAt: httpx.ISO(l.CreatedAt),
	}, nil
}

// ActivePromotions lists running promotions (timed ones not yet ended, bumps of the last 24 h).
func ActivePromotions(ctx context.Context, q db.Querier, listingID string) ([]ActivePromotion, error) {
	rows, err := q.Query(ctx, `select id, type, service_code, starts_at, ends_at from listing_promotions
		where listing_id = $1 and (ends_at > now() or (ends_at is null and starts_at > now() - interval '1 day')) order by starts_at`, listingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ActivePromotion{}
	for rows.Next() {
		var p ActivePromotion
		var starts time.Time
		var ends *time.Time
		if err := rows.Scan(&p.ID, &p.Type, &p.ServiceCode, &starts, &ends); err != nil {
			return nil, err
		}
		p.StartsAt, p.EndsAt = httpx.ISO(starts), httpx.ISOPtr(ends)
		out = append(out, p)
	}
	return out, rows.Err()
}

// ToMyListing maps a listing row to the owner's MyListing DTO.
func ToMyListing(ctx context.Context, q db.Querier, l *ListingRow) (*MyListing, error) {
	card, err := ToListingCard(ctx, q, l)
	if err != nil {
		return nil, err
	}
	promos, err := ActivePromotions(ctx, q, l.ID)
	if err != nil {
		return nil, err
	}
	return &MyListing{
		ListingCard: *card, Views: l.Views, PhoneViews: l.PhoneViews, FavoritesCount: l.FavoritesCount, ExpiresAt: httpx.ISOPtr(l.ExpiresAt),
		RejectionReason: l.RejectionReason, Promotions: promos, RequiresPayment: l.Status == "DRAFT",
	}, nil
}
