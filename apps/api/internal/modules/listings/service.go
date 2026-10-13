package listings

import (
	"context"
	"fmt"
	"net/http"
	"time"

	sq "github.com/Masterminds/squirrel"
	"github.com/jackc/pgx/v5"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/mkt"
	"github.com/alasgarovnamig/evtap/api/internal/modules/agencies"
	"github.com/alasgarovnamig/evtap/api/internal/modules/users"
	"github.com/alasgarovnamig/evtap/api/internal/shared"
)

// MaxMapPoints caps GET /listings/map.
const MaxMapPoints = 500

// Service implements the listings domain and app.ListingsAPI.
type Service struct{ d *app.Deps }

var _ app.ListingsAPI = (*Service)(nil)

func NewService(d *app.Deps) *Service { return &Service{d: d} }

func isStaff(u *auth.User) bool { return u.IsStaff() }

// ───────────────────────────── Search ─────────────────────────────

func (s *Service) Search(ctx context.Context, q *SearchFilters) (httpx.Paginated[Card], error) {
	where := sq.And(BuildConditions(q, SearchOpts{}))
	sqlStr, args, err := SearchQuery(q, SearchOpts{}).ToSql()
	if err != nil {
		return httpx.Paginated[Card]{}, err
	}
	items, err := s.queryCards(ctx, s.d.Pool, sqlStr, args...)
	if err != nil {
		return httpx.Paginated[Card]{}, err
	}
	total, err := s.count(ctx, where)
	if err != nil {
		return httpx.Paginated[Card]{}, err
	}
	return httpx.NewPage(items, total, q.Page, q.PageSize), nil
}

func (s *Service) count(ctx context.Context, where sq.Sqlizer) (int, error) {
	sqlStr, args, err := psql.Select("count(*)::int").From("listings").Where(where).ToSql()
	if err != nil {
		return 0, err
	}
	var c int
	err = s.d.Pool.QueryRow(ctx, sqlStr, args...).Scan(&c)
	return c, err
}

func (s *Service) queryCards(ctx context.Context, q db.Querier, sqlStr string, args ...any) ([]Card, error) {
	rows, err := q.Query(ctx, sqlStr, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Card{}
	for rows.Next() {
		l, err := ScanCard(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l.Card())
	}
	return out, rows.Err()
}

// Featured: random order among listings with an active VIP / premium promotion.
func (s *Service) Featured(ctx context.Context, kind string, dealType, cityID *string, limit int) ([]Card, error) {
	col := "listings.vip_until"
	if kind == "premium" {
		col = "listings.premium_until"
	}
	where := sq.And{sq.Eq{"listings.status": "ACTIVE"}, sq.Expr(col+" > ?", time.Now())}
	if dealType != nil {
		where = append(where, sq.Eq{"listings.deal_type": *dealType})
	}
	if cityID != nil {
		where = append(where, sq.Eq{"listings.city_id": *cityID})
	}
	sqlStr, args, err := psql.Select(CardColumns).From("listings").Where(where).OrderBy("random()").Limit(uint64(limit)).ToSql()
	if err != nil {
		return nil, err
	}
	return s.queryCards(ctx, s.d.Pool, sqlStr, args...)
}

func (s *Service) MapPoints(ctx context.Context, q *SearchFilters) ([]MapPoint, error) {
	if q.BBox == nil {
		return nil, httpx.BadRequest("VALIDATION_ERROR", "bbox is required")
	}
	sqlStr, args, err := psql.Select(CardColumns).From("listings").Where(sq.And(BuildConditions(q, SearchOpts{}))).
		OrderBy(OrderBy(q.Sort)...).Limit(MaxMapPoints).ToSql()
	if err != nil {
		return nil, err
	}
	rows, err := s.d.Pool.Query(ctx, sqlStr, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MapPoint{}
	for rows.Next() {
		l, err := ScanCard(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l.MapPoint())
	}
	return out, rows.Err()
}

// CountNewMatches counts ACTIVE listings matching the filters published within (since, until] (saved-search matcher).
func (s *Service) CountNewMatches(ctx context.Context, q *SearchFilters, since, until time.Time, excludeOwnerID string) (int, error) {
	where := sq.And(BuildConditions(q, SearchOpts{}))
	where = append(where, sq.Gt{"listings.published_at": since}, sq.LtOrEq{"listings.published_at": until})
	if excludeOwnerID != "" {
		where = append(where, sq.NotEq{"listings.owner_id": excludeOwnerID})
	}
	return s.count(ctx, where)
}

// ───────────────────────────── Detail ─────────────────────────────

// GetRow loads a listing with card extras (404 when missing).
func (s *Service) GetRow(ctx context.Context, q db.Querier, id string) (*Row, error) {
	l, err := ScanCard(q.QueryRow(ctx, `select `+CardColumns+` from listings where listings.id = $1`, id))
	if db.IsNoRows(err) {
		return nil, httpx.NotFound("Listing")
	}
	return l, err
}

func (s *Service) getOwned(ctx context.Context, id string, u *auth.User) (*Row, error) {
	l, err := s.GetRow(ctx, s.d.Pool, id)
	if err != nil {
		return nil, err
	}
	if l.OwnerID != u.ID {
		return nil, httpx.Forbidden("Not your listing")
	}
	return l, nil
}

// ActivePromotions lists promotions whose endsAt is in the future (newest first).
func (s *Service) ActivePromotions(ctx context.Context, q db.Querier, listingID string) ([]Promotion, error) {
	m, err := s.promotionsFor(ctx, q, []string{listingID})
	if err != nil {
		return nil, err
	}
	if p := m[listingID]; p != nil {
		return p, nil
	}
	return []Promotion{}, nil
}

func (s *Service) promotionsFor(ctx context.Context, q db.Querier, ids []string) (map[string][]Promotion, error) {
	out := map[string][]Promotion{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `select id, listing_id, type, service_code, starts_at, ends_at from listing_promotions
		where listing_id = any($1::uuid[]) and ends_at > now() order by starts_at desc`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var p Promotion
		var lid string
		var starts time.Time
		var ends *time.Time
		if err := rows.Scan(&p.ID, &lid, &p.Type, &p.ServiceCode, &starts, &ends); err != nil {
			return nil, err
		}
		p.StartsAt, p.EndsAt = httpx.ISO(starts), httpx.ISOPtr(ends)
		out[lid] = append(out[lid], p)
	}
	return out, rows.Err()
}

// Detail is the ListingDetail DTO.
type Detail struct {
	Card
	Description        string            `json:"description"`
	Images             []Image           `json:"images"`
	Bathrooms          *int              `json:"bathrooms"`
	YearBuilt          *int              `json:"yearBuilt"`
	CeilingHeight      *float64          `json:"ceilingHeight"`
	Repair             *string           `json:"repair"`
	Amenities          []string          `json:"amenities"`
	MaxGuests          *int              `json:"maxGuests"`
	MinNights          *int              `json:"minNights"`
	CheckInTime        *string           `json:"checkInTime"`
	CheckOutTime       *string           `json:"checkOutTime"`
	HouseRules         *string           `json:"houseRules"`
	ContactName        string            `json:"contactName"`
	ContactPhoneMasked string            `json:"contactPhoneMasked"`
	ContactPhone       *string           `json:"contactPhone"`
	Owner              *users.PublicUser `json:"owner"`
	Agency             *agencies.Summary `json:"agency"`
	Views              int               `json:"views"`
	FavoritesCount     int               `json:"favoritesCount"`
	ReviewsCount       int               `json:"reviewsCount"`
	ExpiresAt          *string           `json:"expiresAt"`
	RejectionReason    *string           `json:"rejectionReason"`
	Promotions         []Promotion       `json:"promotions"`
	IsOwner            bool              `json:"isOwner"`
	IsFavorite         bool              `json:"isFavorite"`
	UpdatedAt          string            `json:"updatedAt"`
}

// GetDetail builds ListingDetail. Non-ACTIVE listings are visible to the owner and staff only.
func (s *Service) GetDetail(ctx context.Context, id string, u *auth.User, countView bool) (*Detail, error) {
	l, err := s.GetRow(ctx, s.d.Pool, id)
	if err != nil {
		return nil, err
	}
	isOwner := u != nil && l.OwnerID == u.ID
	privileged := isOwner || isStaff(u)
	if l.Status != "ACTIVE" && !privileged {
		return nil, httpx.NotFound("Listing")
	}
	if countView && l.Status == "ACTIVE" && !isOwner {
		if _, err := s.d.Pool.Exec(ctx, `update listings set views = views + 1, updated_at = now() where id = $1`, id); err != nil {
			return nil, err
		}
		if err := s.bumpDailyStat(ctx, id, "views"); err != nil {
			return nil, err
		}
		l.Views++
	}
	images, err := s.images(ctx, id)
	if err != nil {
		return nil, err
	}
	owner, err := users.GetPublicUser(ctx, s.d.Pool, l.OwnerID)
	if err != nil {
		return nil, err
	}
	isFav := false
	if u != nil {
		if err := s.d.Pool.QueryRow(ctx, `select exists(select 1 from favorites where user_id = $1 and listing_id = $2)`, u.ID, id).Scan(&isFav); err != nil {
			return nil, err
		}
	}
	var agency *agencies.Summary
	if l.AgencyID != nil {
		if owner.Agency != nil && owner.Agency.ID == *l.AgencyID {
			agency = owner.Agency
		} else if agency, err = agencies.SummaryByID(ctx, s.d.Pool, *l.AgencyID); err != nil {
			return nil, err
		}
	}
	amen := l.Amenities
	if amen == nil {
		amen = []string{}
	}
	d := &Detail{
		Card: l.Card(), Description: l.Description, Images: images, Bathrooms: l.Bathrooms, YearBuilt: l.YearBuilt,
		CeilingHeight: mkt.F32Ptr(l.CeilingHeight), Repair: l.Repair, Amenities: amen, MaxGuests: l.MaxGuests, MinNights: l.MinNights,
		CheckInTime: l.CheckInTime, CheckOutTime: l.CheckOutTime, HouseRules: l.HouseRules, ContactName: l.ContactName,
		ContactPhoneMasked: maskPhone(l.ContactPhone), Owner: owner, Agency: agency, Views: l.Views, FavoritesCount: l.FavoritesCount,
		ReviewsCount: l.ReviewsCount, ExpiresAt: httpx.ISOPtr(l.ExpiresAt), Promotions: []Promotion{}, IsOwner: isOwner, IsFavorite: isFav,
		UpdatedAt: httpx.ISO(l.UpdatedAt),
	}
	if privileged {
		phone := l.ContactPhone
		d.ContactPhone = &phone
		d.RejectionReason = l.RejectionReason
		if d.Promotions, err = s.ActivePromotions(ctx, s.d.Pool, id); err != nil {
			return nil, err
		}
	}
	return d, nil
}

// maskPhone mirrors format.ts maskPhone: "+994501234567" → "+994 50 123 ** **".
func maskPhone(e164 string) string {
	if len(e164) == 13 && e164[0] == '+' && isDigits(e164[1:]) {
		return fmt.Sprintf("+%s %s %s ** **", e164[1:4], e164[4:6], e164[6:9])
	}
	if len(e164) >= 4 {
		return e164[:len(e164)-4] + "****"
	}
	return "****"
}

func isDigits(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

func (s *Service) images(ctx context.Context, listingID string) ([]Image, error) {
	rows, err := s.d.Pool.Query(ctx, `select id, upload_id, url, thumb_url, "order" from listing_images where listing_id = $1 order by "order" asc`, listingID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Image{}
	for rows.Next() {
		var i Image
		if err := rows.Scan(&i.ID, &i.UploadID, &i.URL, &i.ThumbURL, &i.Order); err != nil {
			return nil, err
		}
		out = append(out, i)
	}
	return out, rows.Err()
}

func (s *Service) bumpDailyStat(ctx context.Context, listingID, field string) error {
	col := "views"
	if field == "phoneViews" {
		col = "phone_views"
	}
	_, err := s.d.Pool.Exec(ctx, `insert into listing_daily_stats (listing_id, date, `+col+`) values ($1, (now() at time zone 'UTC')::date, 1)
		on conflict (listing_id, date) do update set `+col+` = listing_daily_stats.`+col+` + 1`, listingID)
	return err
}

func (s *Service) RevealPhone(ctx context.Context, id string, u *auth.User) (map[string]string, error) {
	l, err := s.GetRow(ctx, s.d.Pool, id)
	if err != nil {
		return nil, err
	}
	isOwner := u != nil && l.OwnerID == u.ID
	if l.Status != "ACTIVE" && !isOwner && !isStaff(u) {
		return nil, httpx.NotFound("Listing")
	}
	if l.Status == "ACTIVE" && !isOwner {
		if _, err := s.d.Pool.Exec(ctx, `update listings set phone_views = phone_views + 1, updated_at = now() where id = $1`, id); err != nil {
			return nil, err
		}
		if err := s.bumpDailyStat(ctx, id, "phoneViews"); err != nil {
			return nil, err
		}
	}
	return map[string]string{"phone": l.ContactPhone}, nil
}

func (s *Service) Similar(ctx context.Context, id string) ([]Card, error) {
	l, err := s.GetRow(ctx, s.d.Pool, id)
	if err != nil {
		return nil, err
	}
	district := ""
	if l.DistrictID != nil {
		district = *l.DistrictID
	}
	return s.queryCards(ctx, s.d.Pool, `select `+CardColumns+` from listings
		where listings.status = 'ACTIVE' and listings.id <> $1 and listings.deal_type = $2 and listings.property_type = $3 and listings.city_id = $4
		order by (case when listings.district_id = $5 then 0 else 1 end), abs(listings.price - $6) limit 8`,
		id, l.DealType, l.PropertyType, l.CityID, district, l.Price)
}

// Review DTO.
type Review struct {
	ID        string       `json:"id"`
	ListingID string       `json:"listingId"`
	BookingID string       `json:"bookingId"`
	Author    ReviewAuthor `json:"author"`
	Rating    int          `json:"rating"`
	Comment   string       `json:"comment"`
	CreatedAt string       `json:"createdAt"`
	HostReply *string      `json:"hostReply"`
}

type ReviewAuthor struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	AvatarURL *string `json:"avatarUrl"`
}

func (s *Service) Reviews(ctx context.Context, id string, p httpx.PageArgs) (httpx.Paginated[Review], error) {
	rows, err := s.d.Pool.Query(ctx, `select r.id, r.listing_id, r.booking_id, u.id, u.name, u.avatar_url, r.rating, r.comment, r.created_at, r.host_reply
		from reviews r join users u on u.id = r.author_id where r.listing_id = $1 order by r.created_at desc limit $2 offset $3`, id, p.Limit, p.Offset)
	if err != nil {
		return httpx.Paginated[Review]{}, err
	}
	defer rows.Close()
	items := []Review{}
	for rows.Next() {
		var r Review
		var created time.Time
		if err := rows.Scan(&r.ID, &r.ListingID, &r.BookingID, &r.Author.ID, &r.Author.Name, &r.Author.AvatarURL, &r.Rating, &r.Comment, &created, &r.HostReply); err != nil {
			return httpx.Paginated[Review]{}, err
		}
		r.CreatedAt = httpx.ISO(created)
		items = append(items, r)
	}
	if err := rows.Err(); err != nil {
		return httpx.Paginated[Review]{}, err
	}
	var c int
	if err := s.d.Pool.QueryRow(ctx, `select count(*)::int from reviews where listing_id = $1`, id).Scan(&c); err != nil {
		return httpx.Paginated[Review]{}, err
	}
	return httpx.NewPage(items, c, p.Page, p.PageSize), nil
}

// ───────────────────────────── Availability (daily rent) ─────────────────────────────

type BookedRange struct {
	CheckIn  string `json:"checkIn"`
	CheckOut string `json:"checkOut"`
}

type Availability struct {
	ListingID    string        `json:"listingId"`
	BlockedDates []string      `json:"blockedDates"`
	BookedRanges []BookedRange `json:"bookedRanges"`
}

func (s *Service) GetAvailability(ctx context.Context, id string, from, to *string) (*Availability, error) {
	if _, err := s.GetRow(ctx, s.d.Pool, id); err != nil {
		return nil, err
	}
	start := mkt.YMD(time.Now())
	if from != nil {
		start = *from
	}
	end := mkt.YMD(mkt.AddDays(time.Now(), 365))
	if to != nil {
		end = *to
	}
	out := &Availability{ListingID: id, BlockedDates: []string{}, BookedRanges: []BookedRange{}}
	rows, err := s.d.Pool.Query(ctx, `select to_char(date, 'YYYY-MM-DD') from listing_blocked_dates
		where listing_id = $1 and date >= $2::date and date <= $3::date order by date asc`, id, start, end)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var d string
		if err := rows.Scan(&d); err != nil {
			rows.Close()
			return nil, err
		}
		out.BlockedDates = append(out.BlockedDates, d)
	}
	rows.Close()
	rows, err = s.d.Pool.Query(ctx, `select to_char(check_in, 'YYYY-MM-DD'), to_char(check_out, 'YYYY-MM-DD') from bookings
		where listing_id = $1 and (status = 'CONFIRMED' or (status = 'PENDING_PAYMENT' and (hold_expires_at is null or hold_expires_at > now())))
		and check_out > $2::date and check_in <= $3::date order by check_in asc`, id, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var b BookedRange
		if err := rows.Scan(&b.CheckIn, &b.CheckOut); err != nil {
			return nil, err
		}
		out.BookedRanges = append(out.BookedRanges, b)
	}
	return out, rows.Err()
}

// SetAvailability replaces the owner's blocked dates from today on (past dates are kept untouched).
func (s *Service) SetAvailability(ctx context.Context, id string, u *auth.User, dates []string) (*Availability, error) {
	l, err := s.getOwned(ctx, id, u)
	if err != nil {
		return nil, err
	}
	if l.DealType != "RENT_DAILY" {
		return nil, httpx.BadRequest("NOT_DAILY_RENT", "Availability is only for daily rent listings")
	}
	today := mkt.YMD(time.Now())
	seen := map[string]bool{}
	future := []string{}
	for _, d := range dates {
		if d >= today && !seen[d] {
			seen[d] = true
			future = append(future, d)
		}
	}
	err = db.WithTx(ctx, s.d.Pool, func(tx pgx.Tx) error {
		if _, e := tx.Exec(ctx, `delete from listing_blocked_dates where listing_id = $1 and date >= $2::date`, id, today); e != nil {
			return e
		}
		if len(future) > 0 {
			_, e := tx.Exec(ctx, `insert into listing_blocked_dates (listing_id, date) select $1, d::date from unnest($2::text[]) d on conflict do nothing`, id, future)
			return e
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.GetAvailability(ctx, id, nil, nil)
}

// ───────────────────────────── Owner stats ─────────────────────────────

type DailyStat struct {
	Date       string `json:"date"`
	Views      int    `json:"views"`
	PhoneViews int    `json:"phoneViews"`
}

type Stats struct {
	Views      int         `json:"views"`
	PhoneViews int         `json:"phoneViews"`
	Favorites  int         `json:"favorites"`
	Messages   int         `json:"messages"`
	Daily      []DailyStat `json:"daily"`
}

func (s *Service) Stats(ctx context.Context, id string, u *auth.User, days int) (*Stats, error) {
	l, err := s.GetRow(ctx, s.d.Pool, id)
	if err != nil {
		return nil, err
	}
	if l.OwnerID != u.ID && !isStaff(u) {
		return nil, httpx.Forbidden("Not your listing")
	}
	since := mkt.YMD(mkt.AddDays(time.Now(), -(days - 1)))
	rows, err := s.d.Pool.Query(ctx, `
		select to_char(d, 'YYYY-MM-DD'), coalesce(s.views, 0)::int, coalesce(s.phone_views, 0)::int
		from generate_series($1::date, current_date, interval '1 day') d
		left join listing_daily_stats s on s.listing_id = $2 and s.date = d::date
		order by d`, since, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := &Stats{Views: l.Views, PhoneViews: l.PhoneViews, Favorites: l.FavoritesCount, Daily: []DailyStat{}}
	for rows.Next() {
		var d DailyStat
		if err := rows.Scan(&d.Date, &d.Views, &d.PhoneViews); err != nil {
			return nil, err
		}
		out.Daily = append(out.Daily, d)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	err = s.d.Pool.QueryRow(ctx, `select count(*)::int from messages m join conversations c on c.id = m.conversation_id
		where c.listing_id = $1 and m.sender_id <> $2`, id, l.OwnerID).Scan(&out.Messages)
	return out, err
}

// ───────────────────────────── Create / update ─────────────────────────────

func invalidLocation(msg string) error { return httpx.BadRequest("INVALID_LOCATION", msg) }

// validateLocation checks city / district / metro consistency and returns the city.
func validateLocation(cityID string, districtID, metroID *string) (*shared.City, error) {
	var city *shared.City
	if cityID != "" {
		if city = shared.CityByID(cityID); city == nil {
			return nil, invalidLocation("Unknown cityId")
		}
	}
	if districtID != nil && *districtID != "" {
		if d := shared.DistrictByID(*districtID); d == nil || d.CityID != cityID {
			return nil, invalidLocation("districtId does not belong to cityId")
		}
	}
	if metroID != nil && *metroID != "" {
		if m := shared.MetroByID(*metroID); m == nil || m.CityID != cityID {
			return nil, invalidLocation("metroId does not belong to cityId")
		}
	}
	return city, nil
}

type resolvedImage struct {
	UploadID      *string
	URL, ThumbURL string
	Order         int
}

// resolveImages turns ordered image ids into listing_images values. Accepts upload ids owned by ownerIDs and —
// when editing — ids of images already attached to the listing (listing_images.id or their uploadId).
func (s *Service) resolveImages(ctx context.Context, imageIDs, ownerIDs []string, listingID string) ([]resolvedImage, error) {
	seen := map[string]bool{}
	ids := []string{}
	for _, id := range imageIDs {
		id = toLower(id)
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	type img struct {
		id            string
		uploadID      *string
		url, thumbURL string
	}
	ups := map[string]img{}
	rows, err := s.d.Pool.Query(ctx, `select id, url, thumb_url from uploads where id = any($1::uuid[]) and user_id = any($2::uuid[])`, ids, ownerIDs)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var i img
		if err := rows.Scan(&i.id, &i.url, &i.thumbURL); err != nil {
			rows.Close()
			return nil, err
		}
		ups[i.id] = i
	}
	rows.Close()
	existing := []img{}
	if listingID != "" {
		rows, err := s.d.Pool.Query(ctx, `select id, upload_id, url, thumb_url from listing_images where listing_id = $1`, listingID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var i img
			if err := rows.Scan(&i.id, &i.uploadID, &i.url, &i.thumbURL); err != nil {
				rows.Close()
				return nil, err
			}
			existing = append(existing, i)
		}
		rows.Close()
	}
	out := make([]resolvedImage, 0, len(ids))
	for order, id := range ids {
		if u, ok := ups[id]; ok {
			uid := u.id
			out = append(out, resolvedImage{UploadID: &uid, URL: u.url, ThumbURL: u.thumbURL, Order: order})
			continue
		}
		found := false
		for _, e := range existing {
			if e.id == id || (e.uploadID != nil && *e.uploadID == id) {
				out = append(out, resolvedImage{UploadID: e.uploadID, URL: e.url, ThumbURL: e.thumbURL, Order: order})
				found = true
				break
			}
		}
		if !found {
			return nil, httpx.BadRequest("INVALID_IMAGES", fmt.Sprintf("Image %s not found or not yours", id))
		}
	}
	return out, nil
}

func toLower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}
	return string(b)
}

func insertImages(ctx context.Context, tx pgx.Tx, listingID string, images []resolvedImage) error {
	for _, i := range images {
		if _, err := tx.Exec(ctx, `insert into listing_images (listing_id, upload_id, url, thumb_url, "order") values ($1,$2,$3,$4,$5)`,
			listingID, i.UploadID, i.URL, i.ThumbURL, i.Order); err != nil {
			return err
		}
	}
	return nil
}

// needsListingFee: whether a new / renewed listing must pay LISTING_FEE. Daily rent is always free (commission model).
func (s *Service) needsListingFee(ctx context.Context, q db.Querier, userID string, agencyID *string, dealType string) (bool, error) {
	if dealType == "RENT_DAILY" {
		return false, nil
	}
	quota, err := s.d.Settings.Quota(ctx, q, userID, agencyID)
	if err != nil {
		return false, err
	}
	return quota.Remaining == 0, nil
}

// publishState: PENDING when moderation is enabled, else ACTIVE with publication dates.
func (s *Service) publishState(ctx context.Context) (map[string]any, error) {
	st, err := s.d.Settings.Settings(ctx)
	if err != nil {
		return nil, err
	}
	if st.ModerationEnabled {
		return map[string]any{"status": "PENDING"}, nil
	}
	now := time.Now()
	return map[string]any{"status": "ACTIVE", "published_at": now, "bumped_at": now, "expires_at": mkt.AddDays(now, st.ListingLifetimeDays)}, nil
}

func (s *Service) Create(ctx context.Context, u *auth.User, in *Input) (*MyListing, error) {
	var ownerID, status string
	var agencyID *string
	err := s.d.Pool.QueryRow(ctx, `select id, status, agency_id from users where id = $1`, u.ID).Scan(&ownerID, &status, &agencyID)
	if db.IsNoRows(err) || (err == nil && status != "ACTIVE") {
		return nil, httpx.Forbidden("Account is not active")
	} else if err != nil {
		return nil, err
	}
	city, err := validateLocation(*in.str("city_id"), in.str("district_id"), in.str("metro_id"))
	if err != nil {
		return nil, err
	}
	images, err := s.resolveImages(ctx, in.ImageIDs, []string{u.ID}, "")
	if err != nil {
		return nil, err
	}
	deal := *in.str("deal_type")
	requiresPayment, err := s.needsListingFee(ctx, s.d.Pool, ownerID, agencyID, deal)
	if err != nil {
		return nil, err
	}
	state := map[string]any{"status": "DRAFT"}
	if !requiresPayment {
		if state, err = s.publishState(ctx); err != nil {
			return nil, err
		}
	}
	values := map[string]any{}
	for k, v := range in.Fields {
		values[k] = v
	}
	for k, v := range state {
		values[k] = v
	}
	values["owner_id"] = ownerID
	values["agency_id"] = agencyID
	values["price_period"] = shared.PricePeriodFor(deal)
	values["country"] = city.Country
	values["is_free_quota"] = !requiresPayment
	sqlStr, args, err := psql.Insert("listings").SetMap(values).Suffix("returning id").ToSql()
	if err != nil {
		return nil, err
	}
	var id string
	err = db.WithTx(ctx, s.d.Pool, func(tx pgx.Tx) error {
		if e := tx.QueryRow(ctx, sqlStr, args...).Scan(&id); e != nil {
			return e
		}
		return insertImages(ctx, tx, id, images)
	})
	if err != nil {
		return nil, err
	}
	return s.GetMine(ctx, s.d.Pool, id)
}

// GetMine returns the owner view of a listing.
func (s *Service) GetMine(ctx context.Context, q db.Querier, id string) (*MyListing, error) {
	l, err := s.GetRow(ctx, q, id)
	if err != nil {
		return nil, err
	}
	promos, err := s.ActivePromotions(ctx, q, id)
	if err != nil {
		return nil, err
	}
	m := l.MyListing(promos)
	return &m, nil
}

// Update is the owner edit. ACTIVE (and REJECTED) listings go back to moderation when moderation is enabled.
func (s *Service) Update(ctx context.Context, id string, u *auth.User, in *Input) (*MyListing, error) {
	l, err := s.getOwned(ctx, id, u)
	if err != nil {
		return nil, err
	}
	if l.Status == "BLOCKED" {
		return nil, httpx.E(http.StatusForbidden, "LISTING_BLOCKED", "Blocked listings cannot be edited")
	}
	if l.Status == "ARCHIVED" {
		return nil, httpx.BadRequest("INVALID_STATUS", "Restore the listing before editing")
	}
	if err := s.ApplyUpdate(ctx, l, in, []string{l.OwnerID}); err != nil {
		return nil, err
	}
	if l.Status == "ACTIVE" || l.Status == "REJECTED" {
		st, err := s.d.Settings.Settings(ctx)
		if err != nil {
			return nil, err
		}
		if st.ModerationEnabled {
			if _, err := s.d.Pool.Exec(ctx, `update listings set status = 'PENDING', rejection_reason = null, updated_at = now() where id = $1`, id); err != nil {
				return nil, err
			}
		} else if l.Status == "REJECTED" {
			state, err := s.publishState(ctx)
			if err != nil {
				return nil, err
			}
			state["rejection_reason"] = nil
			if err := s.updateListing(ctx, s.d.Pool, id, state); err != nil {
				return nil, err
			}
		}
	}
	return s.GetMine(ctx, s.d.Pool, id)
}

func (s *Service) updateListing(ctx context.Context, q db.Querier, id string, set map[string]any) error {
	set["updated_at"] = sq.Expr("now()")
	sqlStr, args, err := psql.Update("listings").SetMap(set).Where(sq.Eq{"id": id}).ToSql()
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, sqlStr, args...)
	return err
}

// ApplyUpdate is the field update shared by owner and admin edit (no status changes).
func (s *Service) ApplyUpdate(ctx context.Context, l *Row, in *Input, imageOwnerIDs []string) error {
	patch := map[string]any{}
	for k, v := range in.Fields {
		patch[k] = v
	}
	cityPatch := in.str("city_id")
	_, hasDistrict := in.Fields["district_id"]
	_, hasMetro := in.Fields["metro_id"]
	if cityPatch != nil || hasDistrict || hasMetro {
		cityID := l.CityID
		district, metro := l.DistrictID, l.MetroID
		if cityPatch != nil {
			cityID = *cityPatch
		}
		if hasDistrict {
			district = in.str("district_id")
		}
		if hasMetro {
			metro = in.str("metro_id")
		}
		// Changing the city without new district/metro drops the old ones.
		if cityPatch != nil && *cityPatch != l.CityID {
			if !hasDistrict {
				district = nil
			}
			if !hasMetro {
				metro = nil
			}
		}
		city, err := validateLocation(cityID, district, metro)
		if err != nil {
			return err
		}
		patch["city_id"], patch["district_id"], patch["metro_id"], patch["country"] = cityID, district, metro, city.Country
	}
	if deal := in.str("deal_type"); deal != nil {
		patch["price_period"] = shared.PricePeriodFor(*deal)
	}
	floor, total := l.Floor, l.TotalFloors
	if _, ok := in.Fields["floor"]; ok {
		floor = in.intv("floor")
	}
	if _, ok := in.Fields["total_floors"]; ok {
		total = in.intv("total_floors")
	}
	if floor != nil && total != nil && *floor > *total {
		return httpx.BadRequest("VALIDATION_ERROR", "Floor cannot exceed total floors")
	}
	if in.IsVerified != nil {
		patch["is_verified"] = *in.IsVerified
	}
	var images []resolvedImage
	if in.HasImages {
		var err error
		if images, err = s.resolveImages(ctx, in.ImageIDs, imageOwnerIDs, l.ID); err != nil {
			return err
		}
	}
	return db.WithTx(ctx, s.d.Pool, func(tx pgx.Tx) error {
		if err := s.updateListing(ctx, tx, l.ID, patch); err != nil {
			return err
		}
		if in.HasImages {
			if _, err := tx.Exec(ctx, `delete from listing_images where listing_id = $1`, l.ID); err != nil {
				return err
			}
			return insertImages(ctx, tx, l.ID, images)
		}
		return nil
	})
}

// ───────────────────────────── Status actions ─────────────────────────────

func (s *Service) Action(ctx context.Context, id string, u *auth.User, action string) (*MyListing, error) {
	l, err := s.getOwned(ctx, id, u)
	if err != nil {
		return nil, err
	}
	bad := httpx.BadRequest("INVALID_STATUS_TRANSITION", fmt.Sprintf("Cannot %s a listing in status %s", action, l.Status))
	in := func(list ...string) bool { return shared.In(l.Status, list) }
	st, err := s.d.Settings.Settings(ctx)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	var patch map[string]any
	switch action {
	case "MARK_SOLD":
		if !in("ACTIVE", "EXPIRED") {
			return nil, bad
		}
		patch = map[string]any{"status": "SOLD"}
	case "ARCHIVE":
		if in("ARCHIVED", "BLOCKED") {
			return nil, bad
		}
		patch = map[string]any{"status": "ARCHIVED"}
	case "RENEW":
		if !in("EXPIRED", "ACTIVE") {
			return nil, bad
		}
		if l.Status == "EXPIRED" {
			var agencyID *string
			if err := s.d.Pool.QueryRow(ctx, `select agency_id from users where id = $1`, l.OwnerID).Scan(&agencyID); err != nil {
				return nil, err
			}
			need, err := s.needsListingFee(ctx, s.d.Pool, l.OwnerID, agencyID, l.DealType)
			if err != nil {
				return nil, err
			}
			if need {
				patch = map[string]any{"status": "DRAFT", "is_free_quota": false}
				break
			}
		}
		published := now
		if l.PublishedAt != nil {
			published = *l.PublishedAt
		}
		patch = map[string]any{"status": "ACTIVE", "expires_at": mkt.AddDays(now, st.ListingLifetimeDays), "bumped_at": now, "published_at": published}
	case "RESTORE":
		if !in("ARCHIVED", "SOLD") {
			return nil, bad
		}
		patch = map[string]any{"status": "PENDING", "rejection_reason": nil}
		if !st.ModerationEnabled {
			state, err := s.publishState(ctx)
			if err != nil {
				return nil, err
			}
			for k, v := range state {
				patch[k] = v
			}
		}
	default:
		return nil, bad
	}
	if err := s.updateListing(ctx, s.d.Pool, id, patch); err != nil {
		return nil, err
	}
	return s.GetMine(ctx, s.d.Pool, id)
}

// Remove is the soft delete (ARCHIVED).
func (s *Service) Remove(ctx context.Context, id string, u *auth.User) error {
	l, err := s.getOwned(ctx, id, u)
	if err != nil {
		return err
	}
	if l.Status != "ARCHIVED" {
		return s.updateListing(ctx, s.d.Pool, id, map[string]any{"status": "ARCHIVED"})
	}
	return nil
}

func (s *Service) Report(ctx context.Context, id string, u *auth.User, reason string, comment *string) error {
	if _, err := s.GetRow(ctx, s.d.Pool, id); err != nil {
		return err
	}
	var reporter *string
	if u != nil {
		var dup bool
		if err := s.d.Pool.QueryRow(ctx, `select exists(select 1 from listing_reports where listing_id = $1 and reporter_id = $2 and status = 'OPEN')`,
			id, u.ID).Scan(&dup); err != nil {
			return err
		}
		if dup {
			return nil
		}
		reporter = &u.ID
	}
	_, err := s.d.Pool.Exec(ctx, `insert into listing_reports (listing_id, reporter_id, reason, comment) values ($1,$2,$3,$4)`, id, reporter, reason, comment)
	return err
}

func (s *Service) MyListings(ctx context.Context, userID string, status *string, p httpx.PageArgs) (httpx.Paginated[MyListing], error) {
	where := sq.And{sq.Eq{"listings.owner_id": userID}}
	if status != nil {
		where = append(where, sq.Eq{"listings.status": *status})
	}
	sqlStr, args, err := psql.Select(CardColumns).From("listings").Where(where).OrderBy("listings.created_at desc").
		Limit(uint64(p.Limit)).Offset(uint64(p.Offset)).ToSql()
	if err != nil {
		return httpx.Paginated[MyListing]{}, err
	}
	rows, err := s.d.Pool.Query(ctx, sqlStr, args...)
	if err != nil {
		return httpx.Paginated[MyListing]{}, err
	}
	list := []*Row{}
	ids := []string{}
	for rows.Next() {
		l, err := ScanCard(rows)
		if err != nil {
			rows.Close()
			return httpx.Paginated[MyListing]{}, err
		}
		list = append(list, l)
		ids = append(ids, l.ID)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return httpx.Paginated[MyListing]{}, err
	}
	total, err := s.count(ctx, where)
	if err != nil {
		return httpx.Paginated[MyListing]{}, err
	}
	promos, err := s.promotionsFor(ctx, s.d.Pool, ids)
	if err != nil {
		return httpx.Paginated[MyListing]{}, err
	}
	items := make([]MyListing, 0, len(list))
	for _, l := range list {
		items = append(items, l.MyListing(promos[l.ID]))
	}
	return httpx.NewPage(items, total, p.Page, p.PageSize), nil
}

// ───────────────────────────── Cross-module contract (payments) ─────────────────────────────

// MarkListingFeePaid: LISTING_FEE paid → DRAFT becomes PENDING (or ACTIVE when moderation is disabled). Idempotent.
func (s *Service) MarkListingFeePaid(ctx context.Context, q db.Querier, listingID string) error {
	var status string
	err := q.QueryRow(ctx, `select status from listings where id = $1`, listingID).Scan(&status)
	if db.IsNoRows(err) {
		return httpx.NotFound("Listing")
	} else if err != nil {
		return err
	}
	if status != "DRAFT" {
		return nil
	}
	state, err := s.publishState(ctx)
	if err != nil {
		return err
	}
	state["is_free_quota"] = false
	state["updated_at"] = sq.Expr("now()")
	sqlStr, args, err := psql.Update("listings").SetMap(state).Where(sq.Eq{"id": listingID, "status": "DRAFT"}).ToSql()
	if err != nil {
		return err
	}
	_, err = q.Exec(ctx, sqlStr, args...)
	return err
}

// SetVerified grants (or, on refund, revokes) the "Yoxlanılıb" badge.
func (s *Service) SetVerified(ctx context.Context, q db.Querier, listingID string, verified bool) error {
	tag, err := q.Exec(ctx, `update listings set is_verified = $2, updated_at = now() where id = $1`, listingID, verified)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return httpx.NotFound("Listing")
	}
	return nil
}
