package listings

import (
	"net/url"
	"regexp"
	"strings"
	"testing"
	"time"
)

// render parses a raw query like GET /listings would and renders the card SELECT (port of the TS unit tests).
func render(t *testing.T, raw map[string]any) (string, []any) {
	t.Helper()
	q, errs := ParseSearch(raw)
	if errs != nil {
		t.Fatalf("parse %v: %v", raw, errs)
	}
	sqlStr, args, err := SearchQuery(q, SearchOpts{Now: time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)}).ToSql()
	if err != nil {
		t.Fatal(err)
	}
	return strings.Join(strings.Fields(sqlStr), " "), args
}

func match(t *testing.T, sqlStr, pattern string) {
	t.Helper()
	if !regexp.MustCompile(pattern).MatchString(sqlStr) {
		t.Errorf("SQL does not match %q:\n%s", pattern, sqlStr)
	}
}

func hasArg(args []any, want any) bool {
	for _, a := range args {
		switch v := a.(type) {
		case []string:
			for _, s := range v {
				if s == want {
					return true
				}
			}
		default:
			if a == want {
				return true
			}
		}
	}
	return false
}

func TestDefaultsToActiveOrderedByBumpedAt(t *testing.T) {
	sqlStr, args := render(t, map[string]any{})
	match(t, sqlStr, `WHERE \(listings\.status = \$1\)`)
	if args[0] != "ACTIVE" {
		t.Errorf("first arg = %v, want ACTIVE", args[0])
	}
	match(t, sqlStr, `ORDER BY listings\.bumped_at desc, listings\.id desc LIMIT 24 OFFSET 0`)
}

func TestRoomsFiveMeansFivePlus(t *testing.T) {
	sqlStr, args := render(t, map[string]any{"rooms": "2,5"})
	match(t, sqlStr, `\(listings\.rooms IN \(\$\d+\) OR listings\.rooms >= \$\d+\)`)
	if !hasArg(args, 2) || !hasArg(args, 5) {
		t.Errorf("args %v must contain 2 and 5", args)
	}
	sqlStr, _ = render(t, map[string]any{"rooms": "7"})
	match(t, sqlStr, `listings\.rooms >= \$\d+`)
	if strings.Contains(sqlStr, "listings.rooms IN") {
		t.Error("rooms=7 must only use >= 5")
	}
}

func TestAmenitiesContainAllAndCSVInLists(t *testing.T) {
	sqlStr, args := render(t, map[string]any{"amenities": "BALCONY,ELEVATOR", "districtId": "baku-yasamal,baku-nasimi"})
	match(t, sqlStr, `listings\.amenities @> \$\d+::text\[\]`)
	match(t, sqlStr, `listings\.district_id IN \(\$\d+,\$\d+\)`)
	if !hasArg(args, "BALCONY") || !hasArg(args, "baku-nasimi") {
		t.Errorf("args %v", args)
	}
}

func TestQSearchesTitleDescriptionAddressEscaped(t *testing.T) {
	sqlStr, args := render(t, map[string]any{"q": "50%_off"})
	match(t, sqlStr, `listings\.title ilike \$\d+ or listings\.description ilike \$\d+ or coalesce\(listings\.address, ''\) ilike`)
	if !hasArg(args, `%50\%\_off%`) {
		t.Errorf("escaped pattern missing in %v", args)
	}
}

func TestDailyAvailabilityExcludesBookingsAndBlockedDates(t *testing.T) {
	sqlStr, args := render(t, map[string]any{"checkIn": "2026-11-01", "checkOut": "2026-11-04", "guests": "3"})
	match(t, sqlStr, `not exists \(select 1 from bookings b where b\.listing_id = listings\.id`)
	match(t, sqlStr, `b\.status = 'CONFIRMED' or \(b\.status = 'PENDING_PAYMENT' and \(b\.hold_expires_at is null or b\.hold_expires_at > \$\d+::timestamptz\)\)`)
	match(t, sqlStr, `not exists \(select 1 from listing_blocked_dates bd`)
	match(t, sqlStr, `listings\.max_guests >= \$\d+`)
	match(t, sqlStr, `listings\.min_nights <= \$\d+`)
	if !hasArg(args, "RENT_DAILY") || !hasArg(args, 3) {
		t.Errorf("args %v must contain RENT_DAILY and nights=3", args)
	}
	// checkOut <= checkIn → no availability filter
	sqlStr, _ = render(t, map[string]any{"checkIn": "2026-11-04", "checkOut": "2026-11-01"})
	if strings.Contains(sqlStr, "bookings b") {
		t.Error("inverted range must not filter availability")
	}
}

func TestOwnerTypeFloorsBBoxAndSort(t *testing.T) {
	sqlStr, args := render(t, map[string]any{"ownerType": "OWNER", "notFirstFloor": "true", "notLastFloor": "1",
		"bbox": "49.7,40.3,50.2,40.6", "sort": "price_asc"})
	match(t, sqlStr, `listings\.agency_id is null and exists \(select 1 from users u where u\.id = listings\.owner_id and u\.account_type = 'INDIVIDUAL'\)`)
	match(t, sqlStr, `listings\.floor > 1`)
	match(t, sqlStr, `listings\.floor < listings\.total_floors`)
	match(t, sqlStr, `listings\.lat between \$\d+ and \$\d+`)
	match(t, sqlStr, `listings\.lng between \$\d+ and \$\d+`)
	match(t, sqlStr, `ORDER BY listings\.price asc, listings\.bumped_at desc`)
	if !hasArg(args, 40.3) || !hasArg(args, 50.2) {
		t.Errorf("bbox args missing: %v", args)
	}
	sqlStr, _ = render(t, map[string]any{"ownerType": "BUSINESS"})
	match(t, sqlStr, `listings\.agency_id is not null or exists \(select 1 from users u where u\.id = listings\.owner_id and u\.account_type = 'BUSINESS'\)`)
}

func TestCardSubqueriesReferenceOuterListing(t *testing.T) {
	sqlStr, _ := render(t, map[string]any{})
	match(t, sqlStr, `from listing_images li where li\.listing_id = listings\.id order by li\."order" asc limit 1`)
	match(t, sqlStr, `select u\.account_type from users u where u\.id = listings\.owner_id`)
}

func TestAllFiltersRender(t *testing.T) {
	sqlStr, _ := render(t, map[string]any{"dealType": "SALE", "propertyType": "APARTMENT,HOUSE", "buildingType": "NEW", "country": "AZ",
		"cityId": "baku", "metroId": "28-may", "priceMin": "1000", "priceMax": "200000", "currency": "AZN", "areaMin": "40.5", "areaMax": "200",
		"floorMin": "2", "floorMax": "10", "repair": "EURO", "hasDocument": "true", "mortgageAvailable": "1", "hasPhotos": "true",
		"verified": "true", "agencyId": "5eed0000-0000-4000-8200-000000000001", "ownerId": "5eed0000-0000-4000-8100-000000000001",
		"page": "2", "pageSize": "10"})
	for _, p := range []string{`listings\.deal_type = \$`, `listings\.property_type IN \(\$\d+,\$\d+\)`, `listings\.building_type = \$`,
		`listings\.country = \$`, `listings\.city_id = \$`, `listings\.metro_id IN`, `listings\.price >= \$`, `listings\.price <= \$`,
		`listings\.currency = \$`, `listings\.area >= \$`, `listings\.area <= \$`, `listings\.floor >= \$`, `listings\.floor <= \$`,
		`listings\.repair IN`, `listings\.has_document = \$`, `listings\.mortgage_available = \$`,
		`exists \(select 1 from listing_images li where li\.listing_id = listings\.id\)`, `listings\.is_verified = \$`,
		`listings\.agency_id = \$`, `listings\.owner_id = \$`, `LIMIT 10 OFFSET 10`} {
		match(t, sqlStr, p)
	}
}

func TestParseSearchValidation(t *testing.T) {
	cases := []struct {
		raw  map[string]any
		want string
	}{
		{map[string]any{"dealType": "FOO"}, "dealType: Invalid option"},
		{map[string]any{"rooms": "2,x"}, "rooms.1:"},
		{map[string]any{"pageSize": "61"}, "pageSize: Too big"},
		{map[string]any{"page": "0"}, "page: Too small"},
		{map[string]any{"priceMin": "-1"}, "priceMin: Too small"},
		{map[string]any{"bbox": "1,2,3"}, "bbox:"},
		{map[string]any{"agencyId": "nope"}, "agencyId: Invalid UUID"},
		{map[string]any{"checkIn": "2026-13-40"}, "checkIn: Expected YYYY-MM-DD"},
		{map[string]any{"amenities": []any{"BALCONY", "JACUZZI"}}, "amenities.1: Invalid option"},
		{map[string]any{"guests": "0"}, "guests: Too small"},
		{map[string]any{"cityId": float64(3)}, "cityId: Invalid input: expected string, received number"},
	}
	for _, c := range cases {
		_, errs := ParseSearch(c.raw)
		if errs == nil || !strings.Contains(strings.Join(errs, "\n"), c.want) {
			t.Errorf("%v: errors %v, want %q", c.raw, errs, c.want)
		}
	}
}

func TestParseSearchCoercionAndSavedSearchJSON(t *testing.T) {
	// Saved searches store JSON (numbers, arrays); URL queries are strings / repeated keys.
	q, errs := ParseSearch(map[string]any{"dealType": "SALE", "cityId": "baku", "districtId": []any{"baku-narimanov"},
		"rooms": []any{float64(2), float64(3)}, "priceMax": float64(300000), "verified": true, "unknown": "ignored"})
	if errs != nil {
		t.Fatal(errs)
	}
	if *q.PriceMax != 300000 || len(q.Rooms) != 2 || q.DistrictID[0] != "baku-narimanov" || !*q.Verified || q.PageSize != 24 || q.Sort != "date_desc" {
		t.Errorf("unexpected parse: %+v", q)
	}
	v, _ := url.ParseQuery("metroId=a&metroId=b&notFirstFloor=yes&rooms=&q=%20%20")
	q, errs = ParseSearch(QueryMap(v))
	if errs != nil {
		t.Fatal(errs)
	}
	if len(q.MetroID) != 2 || q.NotFirstFloor != nil || len(q.Rooms) != 0 || q.Q != nil {
		t.Errorf("unexpected parse: %+v", q)
	}
}

func TestParseBBoxAndMaskPhone(t *testing.T) {
	if b := ParseBBox("49.7,40.3,50.2,40.6"); b == nil || b.MinLng != 49.7 || b.MaxLat != 40.6 {
		t.Errorf("bbox %+v", b)
	}
	if ParseBBox("1,2,x,4") != nil {
		t.Error("malformed bbox must be nil")
	}
	if got := maskPhone("+994501234567"); got != "+994 50 123 ** **" {
		t.Errorf("mask = %q", got)
	}
}
