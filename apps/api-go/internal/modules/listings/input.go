package listings

import (
	"regexp"

	"github.com/alasgarovnamig/evtap/api/internal/mkt"
	"github.com/alasgarovnamig/evtap/api/internal/shared"
)

var hhmmRe = regexp.MustCompile(`^\d{2}:\d{2}$`)

// SchemaKeys are the keys of listingBase (createListingSchema / updateListingSchema).
var SchemaKeys = []string{"dealType", "propertyType", "buildingType", "title", "description", "price", "currency", "cityId",
	"districtId", "metroId", "address", "lat", "lng", "area", "landArea", "rooms", "bathrooms", "floor", "totalFloors", "yearBuilt",
	"ceilingHeight", "repair", "hasDocument", "mortgageAvailable", "amenities", "maxGuests", "minNights", "checkInTime",
	"checkOutTime", "houseRules", "contactName", "contactPhone", "imageIds"}

// Input is a validated CreateListingInput / UpdateListingInput (+ admin isVerified). Fields holds only the keys the
// client sent, as column → value (nil = NULL), so PATCH never resets fields that were not sent.
type Input struct {
	Fields     map[string]any
	ImageIDs   []string
	HasImages  bool
	IsVerified *bool
	Keys       []string // provided JSON keys (audit "fields")
}

func (in *Input) str(col string) *string {
	if v, ok := in.Fields[col]; ok && v != nil {
		if s, ok := v.(string); ok {
			return &s
		}
	}
	return nil
}

func (in *Input) intv(col string) *int {
	if v, ok := in.Fields[col]; ok && v != nil {
		if n, ok := v.(int); ok {
			return &n
		}
	}
	return nil
}

func (in *Input) has(col string) bool { _, ok := in.Fields[col]; return ok }

// ParseInput validates listingBase (create = all required + defaults + superRefine; update = .partial()).
// admin=true also accepts isVerified (adminListingUpdateSchema).
func ParseInput(b *mkt.Body, create, admin bool) *Input {
	req := create
	known := SchemaKeys
	if admin {
		known = append(append([]string{}, SchemaKeys...), "isVerified")
	}
	in := &Input{Fields: map[string]any{}, Keys: b.KnownKeys(known...)}
	str := func(key, col string, r mkt.S) {
		if o := b.Str(key, r); o.Present {
			if o.Null {
				in.Fields[col] = nil
			} else {
				in.Fields[col] = o.V
			}
		}
	}
	num := func(key, col string, r mkt.N) {
		if o := b.Num(key, r); o.Present {
			if o.Null {
				in.Fields[col] = nil
			} else {
				in.Fields[col] = o.V
			}
		}
	}
	integer := func(key, col string, r mkt.N) {
		if o := b.Int(key, r); o.Present {
			if o.Null {
				in.Fields[col] = nil
			} else {
				in.Fields[col] = o.V
			}
		}
	}
	str("dealType", "deal_type", mkt.S{Req: req, Enum: shared.Enum.DealTypes})
	str("propertyType", "property_type", mkt.S{Req: req, Enum: shared.Enum.PropertyTypes})
	str("buildingType", "building_type", mkt.S{Null: true, Enum: []string{"NEW", "SECONDARY"}})
	str("title", "title", mkt.S{Req: req, Trim: true, Min: 10, Max: 120})
	str("description", "description", mkt.S{Req: req, Trim: true, Min: 30, Max: 5000})
	if o := b.Int("price", mkt.N{Req: req, Positive: true, Max: mkt.F(1_000_000_000)}); o.Ok() {
		in.Fields["price"] = int64(o.V)
	}
	str("currency", "currency", mkt.S{Enum: shared.Enum.Currencies})
	str("cityId", "city_id", mkt.S{Req: req, Min: 2})
	str("districtId", "district_id", mkt.S{Null: true})
	str("metroId", "metro_id", mkt.S{Null: true})
	str("address", "address", mkt.S{Null: true, Trim: true, Max: 200})
	num("lat", "lat", mkt.N{Null: true, Min: mkt.F(-90), Max: mkt.F(90)})
	num("lng", "lng", mkt.N{Null: true, Min: mkt.F(-180), Max: mkt.F(180)})
	num("area", "area", mkt.N{Req: req, Positive: true, Max: mkt.F(100000)})
	num("landArea", "land_area", mkt.N{Null: true, Positive: true, Max: mkt.F(100000)})
	integer("rooms", "rooms", mkt.N{Null: true, Min: mkt.F(0), Max: mkt.F(50)})
	integer("bathrooms", "bathrooms", mkt.N{Null: true, Min: mkt.F(0), Max: mkt.F(20)})
	integer("floor", "floor", mkt.N{Null: true, Min: mkt.F(-5), Max: mkt.F(200)})
	integer("totalFloors", "total_floors", mkt.N{Null: true, Min: mkt.F(1), Max: mkt.F(200)})
	integer("yearBuilt", "year_built", mkt.N{Null: true, Min: mkt.F(1800), Max: mkt.F(2100)})
	num("ceilingHeight", "ceiling_height", mkt.N{Null: true, Min: mkt.F(2), Max: mkt.F(10)})
	str("repair", "repair", mkt.S{Null: true, Enum: shared.Enum.RepairTypes})
	if o := b.Bool("hasDocument", false, false); o.Ok() {
		in.Fields["has_document"] = o.V
	}
	if o := b.Bool("mortgageAvailable", false, false); o.Ok() {
		in.Fields["mortgage_available"] = o.V
	}
	if o := b.StrArr("amenities", mkt.A{Item: mkt.S{Enum: shared.Enum.Amenities}}); o.Ok() {
		in.Fields["amenities"] = o.V
	}
	integer("maxGuests", "max_guests", mkt.N{Null: true, Min: mkt.F(1), Max: mkt.F(50)})
	integer("minNights", "min_nights", mkt.N{Null: true, Min: mkt.F(1), Max: mkt.F(365)})
	str("checkInTime", "check_in_time", mkt.S{Null: true, Re: hhmmRe})
	str("checkOutTime", "check_out_time", mkt.S{Null: true, Re: hhmmRe})
	str("houseRules", "house_rules", mkt.S{Null: true, Max: 2000})
	str("contactName", "contact_name", mkt.S{Req: req, Trim: true, Min: 2, Max: 80})
	str("contactPhone", "contact_phone", mkt.S{Req: req, Phone: true})
	if o := b.StrArr("imageIds", mkt.A{Req: req, Min: 1, Max: 30, Item: mkt.S{UUID: true}}); o.Ok() {
		in.ImageIDs, in.HasImages = o.V, true
	}
	if admin {
		if o := b.Bool("isVerified", false, false); o.Ok() {
			in.IsVerified = &o.V
		}
	}
	if !create || len(b.Errs()) > 0 {
		return in
	}
	// createListingSchema defaults
	if !in.has("currency") {
		in.Fields["currency"] = "AZN"
	}
	if !in.has("has_document") {
		in.Fields["has_document"] = false
	}
	if !in.has("mortgage_available") {
		in.Fields["mortgage_available"] = false
	}
	if !in.has("amenities") {
		in.Fields["amenities"] = []string{}
	}
	// listingRefine (superRefine)
	deal, prop := in.str("deal_type"), in.str("property_type")
	if mg := in.intv("max_guests"); deal != nil && *deal == "RENT_DAILY" && (mg == nil || *mg == 0) {
		b.Add("maxGuests", "Required for daily rent")
	}
	if f, t := in.intv("floor"), in.intv("total_floors"); f != nil && t != nil && *f > *t {
		b.Add("floor", "Floor cannot exceed total floors")
	}
	if prop != nil && (*prop == "APARTMENT" || *prop == "HOUSE" || *prop == "ROOM") && in.intv("rooms") == nil {
		b.Add("rooms", "Rooms required")
	}
	return in
}
