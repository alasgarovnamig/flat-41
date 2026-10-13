package listings

import (
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	sq "github.com/Masterminds/squirrel"

	"github.com/alasgarovnamig/evtap/api/internal/mkt"
	"github.com/alasgarovnamig/evtap/api/internal/shared"
)

// SearchFilters is the parsed listingSearchSchema (ListingSearchParsed). Shared by GET /listings, /listings/map
// and the saved-search matcher, so a saved search matches exactly what the user saw in results.
type SearchFilters struct {
	Q                 *string
	DealType          *string
	PropertyType      []string
	BuildingType      *string
	Country           *string
	CityID            *string
	DistrictID        []string
	MetroID           []string
	PriceMin          *int64
	PriceMax          *int64
	Currency          *string
	AreaMin           *float64
	AreaMax           *float64
	Rooms             []int // 5 means 5+
	FloorMin          *int
	FloorMax          *int
	NotFirstFloor     *bool
	NotLastFloor      *bool
	Repair            []string
	HasDocument       *bool
	MortgageAvailable *bool
	Amenities         []string
	OwnerType         *string
	HasPhotos         *bool
	Verified          *bool
	AgencyID          *string
	OwnerID           *string
	CheckIn           *string
	CheckOut          *string
	Guests            *int
	BBox              *string
	Sort              string
	Page              int
	PageSize          int
}

var (
	bboxRe    = regexp.MustCompile(`^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$`)
	isoDateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	sorts     = []string{"date_desc", "price_asc", "price_desc", "area_asc", "area_desc"}
)

// QueryMap converts URL query values to the shape Express hands to zod: a string, or an array for repeated keys.
func QueryMap(v url.Values) map[string]any {
	m := map[string]any{}
	for k, vals := range v {
		if len(vals) == 1 {
			m[k] = vals[0]
		} else {
			arr := make([]any, len(vals))
			for i, s := range vals {
				arr[i] = s
			}
			m[k] = arr
		}
	}
	return m
}

type parser struct {
	m    map[string]any
	errs []string
}

func (p *parser) fail(k, msg string) { p.errs = append(p.errs, k+": "+msg) }

func typeOf(v any) string {
	switch v.(type) {
	case nil:
		return "null"
	case string:
		return "string"
	case bool:
		return "boolean"
	case float64, int, int64:
		return "number"
	case []any, []string:
		return "array"
	}
	return "object"
}

func (p *parser) get(k string) (any, bool) {
	v, ok := p.m[k]
	if !ok {
		return nil, false
	}
	if s, isStr := v.(string); isStr && strings.TrimSpace(s) == "" && k != "q" {
		return nil, false // empty query param = absent
	}
	return v, true
}

func (p *parser) str(k string, enum []string) *string {
	v, ok := p.get(k)
	if !ok {
		return nil
	}
	s, isStr := v.(string)
	if !isStr {
		p.fail(k, "Invalid input: expected string, received "+typeOf(v))
		return nil
	}
	if enum != nil && !shared.In(s, enum) {
		p.fail(k, `Invalid option: expected one of "`+strings.Join(enum, `"|"`)+`"`)
		return nil
	}
	return &s
}

// coerce mirrors z.coerce.number(): Number(v).
func coerce(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case int:
		return float64(x), true
	case int64:
		return float64(x), true
	case bool:
		if x {
			return 1, true
		}
		return 0, true
	case string:
		s := strings.TrimSpace(x)
		if s == "" {
			return 0, true
		}
		f, err := strconv.ParseFloat(s, 64)
		if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
			return 0, false
		}
		return f, true
	}
	return 0, false
}

func (p *parser) num(k string, isInt bool, min *float64) *float64 {
	v, ok := p.get(k)
	if !ok {
		return nil
	}
	return p.numVal(k, v, isInt, min)
}

func (p *parser) numVal(k string, v any, isInt bool, min *float64) *float64 {
	f, ok := coerce(v)
	if !ok {
		p.fail(k, "Invalid input: expected number, received NaN")
		return nil
	}
	if isInt && f != math.Trunc(f) {
		p.fail(k, "Invalid input: expected int, received number")
		return nil
	}
	if min != nil && f < *min {
		p.fail(k, "Too small: expected number to be >="+strconv.FormatFloat(*min, 'f', -1, 64))
		return nil
	}
	return &f
}

func (p *parser) intp(k string, min *float64) *int {
	f := p.num(k, true, min)
	if f == nil {
		return nil
	}
	n := int(*f)
	return &n
}

// boolQ: 'true' | '1' | true → true; 'false' | '0' | false → false; anything else → undefined.
func (p *parser) boolQ(k string) *bool {
	v, ok := p.m[k]
	if !ok {
		return nil
	}
	switch v {
	case "true", "1", true:
		return mkt.Ptr(true)
	case "false", "0", false:
		return mkt.Ptr(false)
	}
	return nil
}

// csv: "a,b" → ["a","b"] (empty parts dropped); arrays pass through.
func (p *parser) csv(k string) ([]any, bool) {
	v, ok := p.m[k]
	if !ok {
		return nil, false
	}
	switch x := v.(type) {
	case string:
		out := []any{}
		for _, s := range strings.Split(x, ",") {
			if s != "" {
				out = append(out, s)
			}
		}
		return out, true
	case []any:
		return x, true
	case []string:
		out := make([]any, len(x))
		for i, s := range x {
			out[i] = s
		}
		return out, true
	}
	p.fail(k, "Invalid input: expected array, received "+typeOf(v))
	return nil, false
}

func (p *parser) csvStr(k string, enum []string) []string {
	items, ok := p.csv(k)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(items))
	for i, it := range items {
		s, isStr := it.(string)
		if !isStr {
			p.fail(fmt.Sprintf("%s.%d", k, i), "Invalid input: expected string, received "+typeOf(it))
			continue
		}
		if enum != nil && !shared.In(s, enum) {
			p.fail(fmt.Sprintf("%s.%d", k, i), `Invalid option: expected one of "`+strings.Join(enum, `"|"`)+`"`)
			continue
		}
		out = append(out, s)
	}
	return out
}

func (p *parser) csvInt(k string) []int {
	items, ok := p.csv(k)
	if !ok {
		return nil
	}
	out := make([]int, 0, len(items))
	for i, it := range items {
		f := p.numVal(fmt.Sprintf("%s.%d", k, i), it, true, nil)
		if f != nil {
			out = append(out, int(*f))
		}
	}
	return out
}

func (p *parser) regex(k string, re *regexp.Regexp, msg string) *string {
	s := p.str(k, nil)
	if s != nil && !re.MatchString(*s) {
		p.fail(k, msg)
		return nil
	}
	return s
}

// ParseSearch validates a raw query object against listingSearchSchema. Unknown keys are ignored.
func ParseSearch(m map[string]any) (*SearchFilters, []string) {
	p := &parser{m: m}
	zero := mkt.F(0)
	q := &SearchFilters{}
	if s := p.str("q", nil); s != nil {
		t := strings.TrimSpace(*s)
		if len([]rune(t)) > 100 {
			p.fail("q", "Too big: expected string to have <=100 characters")
		} else if t != "" {
			q.Q = &t
		}
	}
	q.DealType = p.str("dealType", shared.Enum.DealTypes)
	q.PropertyType = p.csvStr("propertyType", shared.Enum.PropertyTypes)
	q.BuildingType = p.str("buildingType", []string{"NEW", "SECONDARY"})
	q.Country = p.str("country", []string{"AZ", "GE"})
	q.CityID = p.str("cityId", nil)
	q.DistrictID = p.csvStr("districtId", nil)
	q.MetroID = p.csvStr("metroId", nil)
	if f := p.num("priceMin", true, zero); f != nil {
		q.PriceMin = mkt.Ptr(int64(*f))
	}
	if f := p.num("priceMax", true, zero); f != nil {
		q.PriceMax = mkt.Ptr(int64(*f))
	}
	q.Currency = p.str("currency", shared.Enum.Currencies)
	q.AreaMin = p.num("areaMin", false, zero)
	q.AreaMax = p.num("areaMax", false, zero)
	q.Rooms = p.csvInt("rooms")
	q.FloorMin = p.intp("floorMin", nil)
	q.FloorMax = p.intp("floorMax", nil)
	q.NotFirstFloor = p.boolQ("notFirstFloor")
	q.NotLastFloor = p.boolQ("notLastFloor")
	q.Repair = p.csvStr("repair", shared.Enum.RepairTypes)
	q.HasDocument = p.boolQ("hasDocument")
	q.MortgageAvailable = p.boolQ("mortgageAvailable")
	q.Amenities = p.csvStr("amenities", shared.Enum.Amenities)
	q.OwnerType = p.str("ownerType", []string{"OWNER", "BUSINESS"})
	q.HasPhotos = p.boolQ("hasPhotos")
	q.Verified = p.boolQ("verified")
	q.AgencyID = p.regex("agencyId", uuidRe, "Invalid UUID")
	q.OwnerID = p.regex("ownerId", uuidRe, "Invalid UUID")
	q.CheckIn = p.regex("checkIn", isoDateRe, "Expected YYYY-MM-DD")
	q.CheckOut = p.regex("checkOut", isoDateRe, "Expected YYYY-MM-DD")
	for _, d := range []struct {
		k string
		v *string
	}{{"checkIn", q.CheckIn}, {"checkOut", q.CheckOut}} {
		if d.v != nil {
			if _, err := time.Parse("2006-01-02", *d.v); err != nil {
				p.fail(d.k, "Expected YYYY-MM-DD")
			}
		}
	}
	q.Guests = p.intp("guests", mkt.F(1))
	q.BBox = p.regex("bbox", bboxRe, "Invalid string: must match pattern /^-?\\d+(\\.\\d+)?(,-?\\d+(\\.\\d+)?){3}$/")
	q.Sort = "date_desc"
	if s := p.str("sort", sorts); s != nil {
		q.Sort = *s
	}
	q.Page = 1
	if n := p.intp("page", mkt.F(1)); n != nil {
		q.Page = *n
	}
	q.PageSize = 24
	if n := p.intp("pageSize", mkt.F(1)); n != nil {
		if *n > 60 {
			p.fail("pageSize", "Too big: expected number to be <=60")
		} else {
			q.PageSize = *n
		}
	}
	if len(p.errs) > 0 {
		return nil, p.errs
	}
	return q, nil
}

var uuidRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// BBox is a parsed "minLng,minLat,maxLng,maxLat".
type BBox struct{ MinLng, MinLat, MaxLng, MaxLat float64 }

// ParseBBox returns nil when malformed.
func ParseBBox(s string) *BBox {
	parts := strings.Split(s, ",")
	if len(parts) != 4 {
		return nil
	}
	var f [4]float64
	for i, x := range parts {
		v, err := strconv.ParseFloat(strings.TrimSpace(x), 64)
		if err != nil || math.IsInf(v, 0) || math.IsNaN(v) {
			return nil
		}
		f[i] = v
	}
	return &BBox{MinLng: f[0], MinLat: f[1], MaxLng: f[2], MaxLat: f[3]}
}

// SearchOpts: AnyStatus drops the ACTIVE restriction; Now is injectable for deterministic tests.
type SearchOpts struct {
	AnyStatus bool
	Now       time.Time
}

// BuildConditions returns the WHERE conditions of a search (on the `listings` table, unaliased).
func BuildConditions(q *SearchFilters, opts SearchOpts) []sq.Sqlizer {
	c := []sq.Sqlizer{}
	if !opts.AnyStatus {
		c = append(c, sq.Eq{"listings.status": "ACTIVE"})
	}
	if q.Q != nil && *q.Q != "" {
		like := "%" + mkt.EscapeLike(*q.Q) + "%"
		c = append(c, sq.Expr("(listings.title ilike ? or listings.description ilike ? or coalesce(listings.address, '') ilike ?)", like, like, like))
	}
	if q.DealType != nil {
		c = append(c, sq.Eq{"listings.deal_type": *q.DealType})
	}
	if len(q.PropertyType) > 0 {
		c = append(c, sq.Eq{"listings.property_type": q.PropertyType})
	}
	if q.BuildingType != nil {
		c = append(c, sq.Eq{"listings.building_type": *q.BuildingType})
	}
	if q.Country != nil {
		c = append(c, sq.Eq{"listings.country": *q.Country})
	}
	if q.CityID != nil {
		c = append(c, sq.Eq{"listings.city_id": *q.CityID})
	}
	if len(q.DistrictID) > 0 {
		c = append(c, sq.Eq{"listings.district_id": q.DistrictID})
	}
	if len(q.MetroID) > 0 {
		c = append(c, sq.Eq{"listings.metro_id": q.MetroID})
	}
	if q.Currency != nil {
		c = append(c, sq.Eq{"listings.currency": *q.Currency})
	}
	if q.PriceMin != nil {
		c = append(c, sq.GtOrEq{"listings.price": *q.PriceMin})
	}
	if q.PriceMax != nil {
		c = append(c, sq.LtOrEq{"listings.price": *q.PriceMax})
	}
	if q.AreaMin != nil {
		c = append(c, sq.GtOrEq{"listings.area": *q.AreaMin})
	}
	if q.AreaMax != nil {
		c = append(c, sq.LtOrEq{"listings.area": *q.AreaMax})
	}
	if len(q.Rooms) > 0 {
		exact := []int{}
		fivePlus := false
		for _, r := range q.Rooms {
			if r < 5 {
				exact = append(exact, r)
			} else {
				fivePlus = true
			}
		}
		parts := sq.Or{}
		if len(exact) > 0 {
			parts = append(parts, sq.Eq{"listings.rooms": exact})
		}
		if fivePlus {
			parts = append(parts, sq.GtOrEq{"listings.rooms": 5})
		}
		if len(parts) == 1 {
			c = append(c, parts[0])
		} else {
			c = append(c, parts)
		}
	}
	if q.FloorMin != nil {
		c = append(c, sq.GtOrEq{"listings.floor": *q.FloorMin})
	}
	if q.FloorMax != nil {
		c = append(c, sq.LtOrEq{"listings.floor": *q.FloorMax})
	}
	if isTrue(q.NotFirstFloor) {
		c = append(c, sq.Expr("listings.floor > 1"))
	}
	if isTrue(q.NotLastFloor) {
		c = append(c, sq.Expr("(listings.floor is not null and listings.total_floors is not null and listings.floor < listings.total_floors)"))
	}
	if len(q.Repair) > 0 {
		c = append(c, sq.Eq{"listings.repair": q.Repair})
	}
	if isTrue(q.HasDocument) {
		c = append(c, sq.Eq{"listings.has_document": true})
	}
	if isTrue(q.MortgageAvailable) {
		c = append(c, sq.Eq{"listings.mortgage_available": true})
	}
	if len(q.Amenities) > 0 {
		c = append(c, sq.Expr("listings.amenities @> ?::text[]", q.Amenities))
	}
	if q.OwnerType != nil {
		switch *q.OwnerType {
		case "BUSINESS":
			c = append(c, sq.Expr("(listings.agency_id is not null or exists (select 1 from users u where u.id = listings.owner_id and u.account_type = 'BUSINESS'))"))
		case "OWNER":
			c = append(c, sq.Expr("(listings.agency_id is null and exists (select 1 from users u where u.id = listings.owner_id and u.account_type = 'INDIVIDUAL'))"))
		}
	}
	if isTrue(q.HasPhotos) {
		c = append(c, sq.Expr("exists (select 1 from listing_images li where li.listing_id = listings.id)"))
	}
	if isTrue(q.Verified) {
		c = append(c, sq.Eq{"listings.is_verified": true})
	}
	if q.AgencyID != nil {
		c = append(c, sq.Eq{"listings.agency_id": *q.AgencyID})
	}
	if q.OwnerID != nil {
		c = append(c, sq.Eq{"listings.owner_id": *q.OwnerID})
	}
	if q.BBox != nil {
		if b := ParseBBox(*q.BBox); b != nil {
			c = append(c, sq.Expr("listings.lat is not null"), sq.Expr("listings.lng is not null"),
				sq.Expr("listings.lat between ? and ?", b.MinLat, b.MaxLat), sq.Expr("listings.lng between ? and ?", b.MinLng, b.MaxLng))
		}
	}
	// Daily rent availability: no overlapping live booking and no blocked date in [checkIn, checkOut).
	if q.Guests != nil {
		c = append(c, sq.Expr("(listings.max_guests is null or listings.max_guests >= ?)", *q.Guests))
	}
	if q.CheckIn != nil && q.CheckOut != nil && *q.CheckOut > *q.CheckIn {
		in, _ := time.Parse("2006-01-02", *q.CheckIn)
		out, _ := time.Parse("2006-01-02", *q.CheckOut)
		nights := int(math.Round(out.Sub(in).Hours() / 24))
		now := opts.Now
		if now.IsZero() {
			now = time.Now()
		}
		c = append(c, sq.Eq{"listings.deal_type": "RENT_DAILY"})
		c = append(c, sq.Expr("(listings.min_nights is null or listings.min_nights <= ?)", nights))
		c = append(c, sq.Expr(`not exists (select 1 from bookings b where b.listing_id = listings.id
      and (b.status = 'CONFIRMED' or (b.status = 'PENDING_PAYMENT' and (b.hold_expires_at is null or b.hold_expires_at > ?::timestamptz)))
      and b.check_in < ?::date and b.check_out > ?::date)`, now.UTC(), *q.CheckOut, *q.CheckIn))
		c = append(c, sq.Expr(`not exists (select 1 from listing_blocked_dates bd where bd.listing_id = listings.id
      and bd.date >= ?::date and bd.date < ?::date)`, *q.CheckIn, *q.CheckOut))
	}
	return c
}

func isTrue(b *bool) bool { return b != nil && *b }

// OrderBy returns the ORDER BY terms for a sort key.
func OrderBy(sort string) []string {
	switch sort {
	case "price_asc":
		return []string{"listings.price asc", "listings.bumped_at desc"}
	case "price_desc":
		return []string{"listings.price desc", "listings.bumped_at desc"}
	case "area_asc":
		return []string{"listings.area asc", "listings.bumped_at desc"}
	case "area_desc":
		return []string{"listings.area desc", "listings.bumped_at desc"}
	}
	return []string{"listings.bumped_at desc", "listings.id desc"}
}

// SearchQuery builds the card SELECT of a search page (used by GET /listings; exposed for tests).
func SearchQuery(q *SearchFilters, opts SearchOpts) sq.SelectBuilder {
	return psql.Select(CardColumns).From("listings").Where(sq.And(BuildConditions(q, opts))).
		OrderBy(OrderBy(q.Sort)...).Limit(uint64(q.PageSize)).Offset(uint64((q.Page - 1) * q.PageSize))
}
