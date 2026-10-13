package listings

import (
	"strings"
	"time"

	sq "github.com/Masterminds/squirrel"
	"github.com/jackc/pgx/v5"

	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/mkt"
)

var psql = sq.StatementBuilder.PlaceholderFormat(sq.Dollar)

// Row is a row of the listings table plus the optional card extras (cover thumb, images count, owner account type).
type Row struct {
	ID                string
	OwnerID           string
	AgencyID          *string
	DealType          string
	PropertyType      string
	BuildingType      *string
	Title             string
	Description       string
	Price             int64
	Currency          string
	PricePeriod       string
	Country           string
	CityID            string
	DistrictID        *string
	MetroID           *string
	Address           *string
	Lat               *float64
	Lng               *float64
	Area              float32
	LandArea          *float32
	Rooms             *int
	Bathrooms         *int
	Floor             *int
	TotalFloors       *int
	YearBuilt         *int
	CeilingHeight     *float32
	Repair            *string
	HasDocument       bool
	MortgageAvailable bool
	Amenities         []string
	MaxGuests         *int
	MinNights         *int
	CheckInTime       *string
	CheckOutTime      *string
	HouseRules        *string
	ContactName       string
	ContactPhone      string
	Status            string
	RejectionReason   *string
	IsVerified        bool
	IsFreeQuota       bool
	Views             int
	PhoneViews        int
	FavoritesCount    int
	RatingAvg         *float32
	ReviewsCount      int
	BumpedAt          time.Time
	VipUntil          *time.Time
	PremiumUntil      *time.Time
	HighlightUntil    *time.Time
	UrgentUntil       *time.Time
	AutoBumpUntil     *time.Time
	PublishedAt       *time.Time
	ExpiresAt         *time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time

	// card extras
	CoverURL         *string
	ImagesCount      int
	OwnerAccountType *string
	// admin extras
	OwnerName    *string
	OwnerPhone   *string
	ReportsCount int
}

const baseColumns = `id, owner_id, agency_id, deal_type, property_type, building_type, title, description, price, currency, price_period,
	country, city_id, district_id, metro_id, address, lat, lng, area, land_area, rooms, bathrooms, floor, total_floors, year_built,
	ceiling_height, repair, has_document, mortgage_available, amenities, max_guests, min_nights, check_in_time, check_out_time,
	house_rules, contact_name, contact_phone, status, rejection_reason, is_verified, is_free_quota, views, phone_views,
	favorites_count, rating_avg, reviews_count, bumped_at, vip_until, premium_until, highlight_until, urgent_until, auto_bump_until,
	published_at, expires_at, created_at, updated_at`

// Columns are every listings column qualified with "listings." (Row scan order).
var Columns = qualify(baseColumns, "listings.")

func qualify(cols, prefix string) string {
	parts := strings.Split(cols, ",")
	for i, p := range parts {
		parts[i] = prefix + strings.TrimSpace(p)
	}
	return strings.Join(parts, ", ")
}

// Card extras: correlated subqueries reference the outer listing explicitly ("listings"."id").
const cardExtras = `(select li.thumb_url from listing_images li where li.listing_id = listings.id order by li."order" asc limit 1) as cover_url,
	(select count(*)::int from listing_images li where li.listing_id = listings.id) as images_count,
	(select u.account_type from users u where u.id = listings.owner_id) as owner_account_type`

const adminExtras = `(select u.name from users u where u.id = listings.owner_id) as owner_name,
	(select u.phone from users u where u.id = listings.owner_id) as owner_phone,
	(select count(*)::int from listing_reports r where r.listing_id = listings.id and r.status = 'OPEN') as reports_count`

// CardColumns = listing columns + cover thumb + images count + owner account type.
var CardColumns = Columns + ",\n\t" + cardExtras

// AdminColumns = CardColumns + owner name / phone + open reports count.
var AdminColumns = CardColumns + ",\n\t" + adminExtras

func (l *Row) dest() []any {
	return []any{&l.ID, &l.OwnerID, &l.AgencyID, &l.DealType, &l.PropertyType, &l.BuildingType, &l.Title, &l.Description, &l.Price,
		&l.Currency, &l.PricePeriod, &l.Country, &l.CityID, &l.DistrictID, &l.MetroID, &l.Address, &l.Lat, &l.Lng, &l.Area, &l.LandArea,
		&l.Rooms, &l.Bathrooms, &l.Floor, &l.TotalFloors, &l.YearBuilt, &l.CeilingHeight, &l.Repair, &l.HasDocument, &l.MortgageAvailable,
		&l.Amenities, &l.MaxGuests, &l.MinNights, &l.CheckInTime, &l.CheckOutTime, &l.HouseRules, &l.ContactName, &l.ContactPhone,
		&l.Status, &l.RejectionReason, &l.IsVerified, &l.IsFreeQuota, &l.Views, &l.PhoneViews, &l.FavoritesCount, &l.RatingAvg,
		&l.ReviewsCount, &l.BumpedAt, &l.VipUntil, &l.PremiumUntil, &l.HighlightUntil, &l.UrgentUntil, &l.AutoBumpUntil, &l.PublishedAt,
		&l.ExpiresAt, &l.CreatedAt, &l.UpdatedAt}
}

// ScanRow scans Columns.
func ScanRow(row pgx.Row) (*Row, error) {
	var l Row
	if err := row.Scan(l.dest()...); err != nil {
		return nil, err
	}
	return &l, nil
}

// ScanCard scans CardColumns.
func ScanCard(row pgx.Row) (*Row, error) {
	var l Row
	if err := row.Scan(append(l.dest(), &l.CoverURL, &l.ImagesCount, &l.OwnerAccountType)...); err != nil {
		return nil, err
	}
	return &l, nil
}

// ScanAdmin scans AdminColumns.
func ScanAdmin(row pgx.Row) (*Row, error) {
	var l Row
	if err := row.Scan(append(l.dest(), &l.CoverURL, &l.ImagesCount, &l.OwnerAccountType, &l.OwnerName, &l.OwnerPhone, &l.ReportsCount)...); err != nil {
		return nil, err
	}
	return &l, nil
}

// Card is the ListingCard DTO.
type Card struct {
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

func activeAt(t *time.Time, now time.Time) bool { return t != nil && t.After(now) }

// Card maps a row (with card extras) to the ListingCard DTO.
func (l *Row) Card() Card {
	now := time.Now()
	var rating *float64
	if l.DealType == "RENT_DAILY" && l.ReviewsCount > 0 {
		rating = mkt.F32Ptr(l.RatingAvg)
	}
	return Card{
		ID: l.ID, Title: l.Title, DealType: l.DealType, PropertyType: l.PropertyType, BuildingType: l.BuildingType, Price: l.Price,
		Currency: l.Currency, PricePeriod: l.PricePeriod, Country: l.Country, CityID: l.CityID, DistrictID: l.DistrictID, MetroID: l.MetroID,
		Address: l.Address, Area: mkt.F32(l.Area), LandArea: mkt.F32Ptr(l.LandArea), Rooms: l.Rooms, Floor: l.Floor, TotalFloors: l.TotalFloors,
		CoverURL: l.CoverURL, ImagesCount: l.ImagesCount, Lat: l.Lat, Lng: l.Lng,
		IsVip: activeAt(l.VipUntil, now), IsPremium: activeAt(l.PremiumUntil, now), IsHighlighted: activeAt(l.HighlightUntil, now),
		IsUrgent: activeAt(l.UrgentUntil, now), IsVerified: l.IsVerified, HasDocument: l.HasDocument, MortgageAvailable: l.MortgageAvailable,
		IsBusiness: l.AgencyID != nil || (l.OwnerAccountType != nil && *l.OwnerAccountType == "BUSINESS"),
		Rating:     rating, Status: l.Status, BumpedAt: httpx.ISO(l.BumpedAt), PublishedAt: httpx.ISOPtr(l.PublishedAt), CreatedAt: httpx.ISO(l.CreatedAt),
	}
}

// Promotion is the ActivePromotion DTO.
type Promotion struct {
	ID          string  `json:"id"`
	Type        string  `json:"type"`
	ServiceCode string  `json:"serviceCode"`
	StartsAt    string  `json:"startsAt"`
	EndsAt      *string `json:"endsAt"`
}

// MyListing is the owner view DTO.
type MyListing struct {
	Card
	Views           int         `json:"views"`
	PhoneViews      int         `json:"phoneViews"`
	FavoritesCount  int         `json:"favoritesCount"`
	ExpiresAt       *string     `json:"expiresAt"`
	RejectionReason *string     `json:"rejectionReason"`
	Promotions      []Promotion `json:"promotions"`
	RequiresPayment bool        `json:"requiresPayment"`
}

func (l *Row) MyListing(promos []Promotion) MyListing {
	if promos == nil {
		promos = []Promotion{}
	}
	return MyListing{Card: l.Card(), Views: l.Views, PhoneViews: l.PhoneViews, FavoritesCount: l.FavoritesCount, ExpiresAt: httpx.ISOPtr(l.ExpiresAt),
		RejectionReason: l.RejectionReason, Promotions: promos, RequiresPayment: l.Status == "DRAFT"}
}

// AdminListing DTO.
type AdminListing struct {
	Card
	OwnerID         string  `json:"ownerId"`
	OwnerName       string  `json:"ownerName"`
	OwnerPhone      *string `json:"ownerPhone"`
	Views           int     `json:"views"`
	RejectionReason *string `json:"rejectionReason"`
	ReportsCount    int     `json:"reportsCount"`
	UpdatedAt       string  `json:"updatedAt"`
}

func (l *Row) Admin() AdminListing {
	name := ""
	if l.OwnerName != nil {
		name = *l.OwnerName
	}
	return AdminListing{Card: l.Card(), OwnerID: l.OwnerID, OwnerName: name, OwnerPhone: l.OwnerPhone, Views: l.Views,
		RejectionReason: l.RejectionReason, ReportsCount: l.ReportsCount, UpdatedAt: httpx.ISO(l.UpdatedAt)}
}

// Image is the ListingImage DTO.
type Image struct {
	ID       string  `json:"id"`
	UploadID *string `json:"uploadId"`
	URL      string  `json:"url"`
	ThumbURL string  `json:"thumbUrl"`
	Order    int     `json:"order"`
}

// MapPoint DTO.
type MapPoint struct {
	ID          string  `json:"id"`
	Lat         float64 `json:"lat"`
	Lng         float64 `json:"lng"`
	Price       int64   `json:"price"`
	Currency    string  `json:"currency"`
	PricePeriod string  `json:"pricePeriod"`
	IsVip       bool    `json:"isVip"`
	IsPremium   bool    `json:"isPremium"`
	Title       string  `json:"title"`
	CoverURL    *string `json:"coverUrl"`
}

func (l *Row) MapPoint() MapPoint {
	now := time.Now()
	var lat, lng float64
	if l.Lat != nil {
		lat = *l.Lat
	}
	if l.Lng != nil {
		lng = *l.Lng
	}
	return MapPoint{ID: l.ID, Lat: lat, Lng: lng, Price: l.Price, Currency: l.Currency, PricePeriod: l.PricePeriod,
		IsVip: activeAt(l.VipUntil, now), IsPremium: activeAt(l.PremiumUntil, now), Title: l.Title, CoverURL: l.CoverURL}
}
