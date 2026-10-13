// Package shared is the Go mirror of @evtap/shared: reference data (embedded JSON exported from TypeScript with
// `pnpm --filter @evtap/shared export:json`), enums, pricing maths and formatting helpers.
package shared

import (
	"embed"
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

//go:embed data/*.json
var dataFS embed.FS

type Localized struct {
	Az string `json:"az"`
	Ru string `json:"ru"`
	En string `json:"en"`
}

func (l Localized) In(locale string) string {
	switch locale {
	case "ru":
		return l.Ru
	case "en":
		return l.En
	}
	return l.Az
}

type Country struct {
	Code        string    `json:"code"`
	Name        Localized `json:"name"`
	Currency    string    `json:"currency"`
	PhonePrefix string    `json:"phonePrefix"`
}
type City struct {
	ID      string    `json:"id"`
	Country string    `json:"country"`
	Name    Localized `json:"name"`
	Lat     float64   `json:"lat"`
	Lng     float64   `json:"lng"`
	Popular bool      `json:"popular,omitempty"`
}
type District struct {
	ID     string    `json:"id"`
	CityID string    `json:"cityId"`
	Name   Localized `json:"name"`
}
type MetroStation struct {
	ID     string    `json:"id"`
	CityID string    `json:"cityId"`
	Line   string    `json:"line"`
	Name   Localized `json:"name"`
	Lat    float64   `json:"lat"`
	Lng    float64   `json:"lng"`
}
type Locations struct {
	Countries     []Country      `json:"countries"`
	Cities        []City         `json:"cities"`
	Districts     []District     `json:"districts"`
	MetroStations []MetroStation `json:"metroStations"`
}

type ServiceDef struct {
	Code          string    `json:"code"`
	PromotionType *string   `json:"promotionType"`
	DurationDays  int       `json:"durationDays"`
	Price         int       `json:"price"`
	Active        bool      `json:"active"`
	SortOrder     int       `json:"sortOrder"`
	Name          Localized `json:"name"`
	Description   Localized `json:"description"`
}
type BundleDef struct {
	Code         string    `json:"code"`
	ServiceCodes []string  `json:"serviceCodes"`
	Price        int       `json:"price"`
	Name         Localized `json:"name"`
}
type PlanDef struct {
	Code                  string    `json:"code"`
	PriceMonthly          int       `json:"priceMonthly"`
	PriceYearly           int       `json:"priceYearly"`
	ListingQuota          int       `json:"listingQuota"`
	MonthlyBumps          int       `json:"monthlyBumps"`
	MonthlyVipCredits     int       `json:"monthlyVipCredits"`
	MonthlyPremiumCredits int       `json:"monthlyPremiumCredits"`
	MaxAgents             int       `json:"maxAgents"`
	Features              []string  `json:"features"`
	Active                bool      `json:"active"`
	Name                  Localized `json:"name"`
}
type TopupBonus struct {
	MinAmount    int     `json:"minAmount"`
	BonusPercent float64 `json:"bonusPercent"`
}
type PlatformSettings struct {
	FreeListingsPerMonth     int          `json:"freeListingsPerMonth"`
	ListingFee               int          `json:"listingFee"`
	ListingLifetimeDays      int          `json:"listingLifetimeDays"`
	DailyRentGuestFeePercent float64      `json:"dailyRentGuestFeePercent"`
	DailyRentHostFeePercent  float64      `json:"dailyRentHostFeePercent"`
	PayoutDelayHours         int          `json:"payoutDelayHours"`
	FreeCancellationHours    int          `json:"freeCancellationHours"`
	TopupBonuses             []TopupBonus `json:"topupBonuses"`
	MinTopup                 int          `json:"minTopup"`
	MaxTopup                 int          `json:"maxTopup"`
	ModerationEnabled        bool         `json:"moderationEnabled"`
}
type Pricing struct {
	Services []ServiceDef     `json:"services"`
	Bundles  []BundleDef      `json:"bundles"`
	Plans    []PlanDef        `json:"plans"`
	Settings PlatformSettings `json:"settings"`
}
type Enums struct {
	DealTypes        []string `json:"dealTypes"`
	PropertyTypes    []string `json:"propertyTypes"`
	RepairTypes      []string `json:"repairTypes"`
	Amenities        []string `json:"amenities"`
	ListingStatuses  []string `json:"listingStatuses"`
	PaymentPurposes  []string `json:"paymentPurposes"`
	PaymentStatuses  []string `json:"paymentStatuses"`
	BookingStatuses  []string `json:"bookingStatuses"`
	ReportReasons    []string `json:"reportReasons"`
	BannerPlacements []string `json:"bannerPlacements"`
	UserRoles        []string `json:"userRoles"`
	UserStatuses     []string `json:"userStatuses"`
	Currencies       []string `json:"currencies"`
	Locales          []string `json:"locales"`
	ErrorCodes       []string `json:"errorCodes"`
}

var (
	Loc  Locations
	Defs Pricing
	Enum Enums
)

func init() {
	must := func(name string, v any) {
		b, err := dataFS.ReadFile("data/" + name)
		if err != nil {
			panic(err)
		}
		if err := json.Unmarshal(b, v); err != nil {
			panic(fmt.Errorf("shared/%s: %w", name, err))
		}
	}
	must("locations.json", &Loc)
	must("pricing.json", &Defs)
	must("enums.json", &Enum)
}

func CityByID(id string) *City {
	for i := range Loc.Cities {
		if Loc.Cities[i].ID == id {
			return &Loc.Cities[i]
		}
	}
	return nil
}
func DistrictByID(id string) *District {
	for i := range Loc.Districts {
		if Loc.Districts[i].ID == id {
			return &Loc.Districts[i]
		}
	}
	return nil
}
func MetroByID(id string) *MetroStation {
	for i := range Loc.MetroStations {
		if Loc.MetroStations[i].ID == id {
			return &Loc.MetroStations[i]
		}
	}
	return nil
}

// In reports whether v is one of list (enum check).
func In(v string, list []string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// ── Validation regexes & phone ─────────────────────────────────────────────
var (
	PhoneRe   = regexp.MustCompile(`^\+99[45]\d{9}$`)
	ISODateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	HHMMRe    = regexp.MustCompile(`^\d{2}:\d{2}$`)
	phoneJunk = regexp.MustCompile(`[\s()\-]`)
)

// NormalizePhone mirrors phoneSchema: strip spaces/brackets/dashes, "0501234567" → "+994501234567".
func NormalizePhone(s string) string {
	v := phoneJunk.ReplaceAllString(strings.TrimSpace(s), "")
	if strings.HasPrefix(v, "0") && len(v) == 10 {
		v = "+994" + v[1:]
	}
	return v
}

// MaskPhone: "+994501234567" → "+994 50 123 ** **".
func MaskPhone(e164 string) string {
	if len(e164) == 13 && strings.HasPrefix(e164, "+") {
		return fmt.Sprintf("+%s %s %s ** **", e164[1:4], e164[4:6], e164[6:9])
	}
	if len(e164) > 4 {
		return e164[:len(e164)-4] + "****"
	}
	return e164
}

// Slugify mirrors the TS slugify (Azerbaijani letters transliterated, max 80 chars).
func Slugify(s string) string {
	r := strings.NewReplacer("ə", "e", "ı", "i", "ö", "o", "ü", "u", "ğ", "g", "ş", "s", "ç", "c", "Ə", "e", "I", "i", "İ", "i")
	s = r.Replace(strings.ToLower(s))
	s = norm.NFKD.String(s)
	var b strings.Builder
	dash := false
	for _, c := range s {
		switch {
		case unicode.Is(unicode.Mn, c):
		case c >= 'a' && c <= 'z' || c >= '0' && c <= '9':
			b.WriteRune(c)
			dash = false
		default:
			if !dash && b.Len() > 0 {
				b.WriteByte('-')
				dash = true
			}
		}
	}
	out := strings.Trim(b.String(), "-")
	if len(out) > 80 {
		out = strings.Trim(out[:80], "-")
	}
	return out
}

// ── Pricing maths (identical to pricing.ts) ────────────────────────────────

// TopupBonusFor returns the bonus (minor units) for a top-up amount.
func TopupBonusFor(amount int, s PlatformSettings) int {
	tiers := append([]TopupBonus(nil), s.TopupBonuses...)
	sort.Slice(tiers, func(i, j int) bool { return tiers[i].MinAmount > tiers[j].MinAmount })
	for _, t := range tiers {
		if amount >= t.MinAmount {
			return int(math.Floor(float64(amount) * t.BonusPercent / 100))
		}
	}
	return 0
}

func PlanPrice(p PlanDef, period string) int {
	if period == "YEAR" {
		return p.PriceYearly
	}
	return p.PriceMonthly
}

// NightsBetween counts nights between two YYYY-MM-DD dates.
func NightsBetween(checkIn, checkOut string) int {
	a, err1 := time.Parse("2006-01-02", checkIn)
	b, err2 := time.Parse("2006-01-02", checkOut)
	if err1 != nil || err2 != nil {
		return 0
	}
	return int(math.Round(b.Sub(a).Hours() / 24))
}

type BookingCalc struct{ Subtotal, GuestFee, HostFee, Total, HostPayout int }

// roundHalfAwayFromZero matches JavaScript Math.round for positive values.
func roundJS(x float64) int { return int(math.Floor(x + 0.5)) }

// CalcBooking: nightly price in MAJOR units → amounts in MINOR units.
func CalcBooking(nightlyMajor, nights int, s PlatformSettings) BookingCalc {
	sub := nightlyMajor * 100 * nights
	gf := roundJS(float64(sub) * s.DailyRentGuestFeePercent / 100)
	hf := roundJS(float64(sub) * s.DailyRentHostFeePercent / 100)
	return BookingCalc{Subtotal: sub, GuestFee: gf, HostFee: hf, Total: sub + gf, HostPayout: sub - hf}
}

// PricePeriodFor derives the listing price period from the deal type.
func PricePeriodFor(dealType string) string {
	switch dealType {
	case "RENT_LONG":
		return "MONTH"
	case "RENT_DAILY":
		return "DAY"
	}
	return "TOTAL"
}
