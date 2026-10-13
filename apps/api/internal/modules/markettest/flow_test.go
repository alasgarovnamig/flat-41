// Package markettest: end-to-end tests of the marketplace modules through the full router (app.Build +
// server.New(d, server.Modules(d))) against a freshly created database (dropped afterwards).
// Admin URL: TEST_ADMIN_DATABASE_URL (default postgres://evtap:evtap@localhost:5432/postgres); skipped when unreachable.
package markettest

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"math/rand"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
	_ "golang.org/x/image/webp" // decode thumbnails

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/config"
	"github.com/alasgarovnamig/evtap/api/internal/core/settings"
	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/server"
)

type env struct {
	t   *testing.T
	d   *app.Deps
	srv *httptest.Server
}

// freshDB creates a uniquely named database and returns its URL plus a cleanup func.
func freshDB(t *testing.T) string {
	t.Helper()
	admin := os.Getenv("TEST_ADMIN_DATABASE_URL")
	if admin == "" {
		admin = "postgres://evtap:evtap@localhost:5432/postgres"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, admin)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	name := fmt.Sprintf("evtap_go_market_test_%d_%d", os.Getpid(), rand.Intn(1_000_000))
	if _, err := conn.Exec(ctx, "create database "+name); err != nil {
		conn.Close(ctx)
		t.Skipf("cannot create test database: %v", err)
	}
	conn.Close(ctx)
	t.Cleanup(func() {
		c, err := pgx.Connect(context.Background(), admin)
		if err == nil {
			_, _ = c.Exec(context.Background(), "drop database if exists "+name+" with (force)")
			c.Close(context.Background())
		}
	})
	i := strings.LastIndex(admin, "/")
	q := ""
	if j := strings.Index(admin[i:], "?"); j >= 0 {
		q = admin[i+j:]
	}
	return admin[:i+1] + name + q
}

func newEnv(t *testing.T) *env {
	t.Helper()
	url := freshDB(t)
	cfg := config.Load()
	cfg.DatabaseURL = url
	cfg.SMS.OTPDevCode = "111111"
	cfg.IsProd = false
	cfg.Storage.Driver = "local"
	cfg.Storage.UploadDir = t.TempDir()
	ctx := context.Background()
	pool, err := db.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	if err := db.Migrate(pool); err != nil {
		t.Fatal(err)
	}
	if err := settings.EnsureDefaults(ctx, pool); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewUnstartedServer(nil)
	cfg.APIPublicURL = "http://" + srv.Listener.Addr().String()
	d := app.Build(cfg, pool)
	srv.Config.Handler = server.New(d, server.Modules(d))
	srv.Start()
	t.Cleanup(srv.Close)
	t.Cleanup(d.Bus.Wait)
	return &env{t: t, d: d, srv: srv}
}

type resp struct {
	status int
	body   map[string]any
	raw    []byte
}

func (r resp) arr() []any {
	var a []any
	_ = json.Unmarshal(r.raw, &a)
	return a
}

func (e *env) do(method, path, token string, body any) resp {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = bytes.NewReader(b)
	}
	req, _ := http.NewRequest(method, e.srv.URL+"/api/v1"+path, rd)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	return e.send(req, token)
}

func (e *env) send(req *http.Request, token string) resp {
	e.t.Helper()
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		e.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	out := resp{status: res.StatusCode, raw: raw}
	_ = json.Unmarshal(raw, &out.body)
	return out
}

func (e *env) expect(r resp, status int, what string) {
	e.t.Helper()
	if r.status != status {
		e.t.Fatalf("%s: status %d, want %d: %s", what, r.status, status, r.raw)
	}
}

func (e *env) otpLogin(phone, name string) string {
	e.t.Helper()
	e.expect(e.do("POST", "/auth/otp/request", "", map[string]any{"phone": phone}), 200, "otp request")
	r := e.do("POST", "/auth/otp/verify", "", map[string]any{"phone": phone, "code": "111111", "name": name})
	e.expect(r, 200, "otp verify")
	return r.body["accessToken"].(string)
}

func (e *env) adminToken() string {
	e.t.Helper()
	hash, _ := bcrypt.GenerateFromPassword([]byte("Admin12345!"), 10)
	if _, err := e.d.Pool.Exec(context.Background(), `insert into users (name, email, password_hash, role, is_email_verified)
		values ('Admin', 'admin@test.az', $1, 'ADMIN', true) on conflict do nothing`, string(hash)); err != nil {
		e.t.Fatal(err)
	}
	r := e.do("POST", "/auth/login", "", map[string]any{"login": "admin@test.az", "password": "Admin12345!"})
	e.expect(r, 200, "admin login")
	return r.body["accessToken"].(string)
}

func jpegBytes(w, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{14, 124, 102, 255})
		}
	}
	var buf bytes.Buffer
	_ = jpeg.Encode(&buf, img, nil)
	return buf.Bytes()
}

func (e *env) upload(token string, data []byte, contentType string) resp {
	e.t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	h := textproto.MIMEHeader{}
	h.Set("Content-Disposition", `form-data; name="file"; filename="photo.jpg"`)
	h.Set("Content-Type", contentType)
	part, _ := mw.CreatePart(h)
	_, _ = part.Write(data)
	_ = mw.Close()
	req, _ := http.NewRequest("POST", e.srv.URL+"/api/v1/uploads", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return e.send(req, token)
}

func listingBody(marker, phone string, imageIDs ...string) map[string]any {
	return map[string]any{
		"dealType": "SALE", "propertyType": "APARTMENT", "buildingType": "NEW", "title": "Test " + marker + " 2 otaqlı mənzil",
		"description": "Avtomatik test üçün yaradılmış elan — metroya yaxın, işıqlı mənzil.", "price": 123456, "cityId": "baku",
		"districtId": "baku-yasamal", "metroId": "elmlar-akademiyasi", "lat": 40.375, "lng": 49.81, "area": 70.5, "rooms": 2, "floor": 3, "totalFloors": 9,
		"amenities": []string{"BALCONY"}, "contactName": "Test", "contactPhone": phone, "imageIds": imageIDs,
	}
}

func TestMarketplaceFlow(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	phone := "+99455" + fmt.Sprint(1_000_000+rand.Intn(8_999_999))
	token := e.otpLogin(phone, "Test User")

	// ── upload ──
	e.expect(e.upload(token, []byte("not an image"), "image/jpeg"), 415, "invalid image")
	e.expect(e.upload(token, jpegBytes(10, 10), "application/pdf"), 415, "unsupported type")
	up := e.upload(token, jpegBytes(2000, 1000), "image/jpeg")
	e.expect(up, 201, "upload")
	uploadID := up.body["id"].(string)
	thumb := up.body["thumbUrl"].(string)
	if !strings.HasSuffix(thumb, "_thumb.webp") || up.body["mime"] != "image/webp" {
		t.Fatalf("upload dto %v", up.body)
	}
	var w, h int
	if err := e.d.Pool.QueryRow(ctx, `select width, height from uploads where id = $1`, uploadID).Scan(&w, &h); err != nil || w != 1600 || h != 800 {
		t.Fatalf("resized to %dx%d (%v), want 1600x800", w, h, err)
	}
	res, err := http.Get(thumb)
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("thumb not served: %v %v", err, res)
	}
	thumbImg, format, err := image.Decode(res.Body)
	res.Body.Close()
	if err != nil || format != "webp" || thumbImg.Bounds().Dx() != 400 {
		t.Fatalf("thumb %v %s", err, format)
	}

	// ── create ──
	marker := fmt.Sprintf("T%d", time.Now().UnixNano())
	bad := e.do("POST", "/listings", token, map[string]any{"dealType": "RENT_DAILY"})
	e.expect(bad, 400, "invalid create")
	if bad.body["code"] != "VALIDATION_ERROR" {
		t.Fatalf("code %v", bad.body)
	}
	wrongLoc := listingBody(marker, phone, uploadID)
	wrongLoc["metroId"] = "unknown-metro"
	if r := e.do("POST", "/listings", token, wrongLoc); r.status != 400 || r.body["code"] != "INVALID_LOCATION" {
		t.Fatalf("wrong location: %d %s", r.status, r.raw)
	}
	created := e.do("POST", "/listings", token, listingBody(marker, phone, uploadID))
	e.expect(created, 201, "create listing")
	id := created.body["id"].(string)
	if created.body["pricePeriod"] != "TOTAL" || created.body["status"] != "PENDING" || created.body["requiresPayment"] != false {
		t.Fatalf("created %s", created.raw)
	}

	// pending listings are not searchable / visible to others
	if r := e.do("GET", "/listings?q="+marker, "", nil); r.body["total"].(float64) != 0 {
		t.Fatalf("pending listing found: %s", r.raw)
	}
	e.expect(e.do("GET", "/listings/"+id, "", nil), 404, "pending detail anonymous")

	// ── admin approve ──
	admin := e.adminToken()
	e.expect(e.do("GET", "/admin/listings?status=PENDING", token, nil), 403, "non-admin")
	queue := e.do("GET", "/admin/listings?status=PENDING", admin, nil)
	e.expect(queue, 200, "moderation queue")
	if queue.body["total"].(float64) < 1 {
		t.Fatalf("queue %s", queue.raw)
	}
	approved := e.do("POST", "/admin/listings/"+id+"/approve", admin, nil)
	e.expect(approved, 200, "approve")
	if approved.body["status"] != "ACTIVE" || approved.body["ownerName"] != "Test User" {
		t.Fatalf("approved %s", approved.raw)
	}
	e.d.Bus.Wait()
	var notes int
	_ = e.d.Pool.QueryRow(ctx, `select count(*) from notifications where type = 'LISTING_APPROVED' and data->>'listingId' = $1`, id).Scan(&notes)
	var audits int
	_ = e.d.Pool.QueryRow(ctx, `select count(*) from audit_logs where action = 'listing.approve' and entity_id = $1`, id).Scan(&audits)
	if notes != 1 || audits != 1 {
		t.Fatalf("approve side effects: notifications=%d audits=%d", notes, audits)
	}

	// ── search finds it ──
	found := e.do("GET", "/listings?q="+marker+"&rooms=2&metroId=elmlar-akademiyasi&amenities=BALCONY&priceMax=200000&hasPhotos=true", "", nil)
	e.expect(found, 200, "search")
	items := found.body["items"].([]any)
	if found.body["total"].(float64) != 1 || items[0].(map[string]any)["id"] != id || items[0].(map[string]any)["coverUrl"] != thumb {
		t.Fatalf("search %s", found.raw)
	}
	if r := e.do("GET", "/listings?q="+marker+"&amenities=BALCONY,POOL", "", nil); r.body["total"].(float64) != 0 {
		t.Fatal("amenities must be contain-all")
	}
	if r := e.do("GET", "/listings?q="+marker+"&ownerType=OWNER", "", nil); r.body["total"].(float64) != 1 {
		t.Fatalf("ownerType OWNER %s", r.raw)
	}
	mp := e.do("GET", "/listings/map?bbox=49.0,40.0,51.0,41.0&q="+marker, "", nil).arr()
	if len(mp) != 1 || mp[0].(map[string]any)["title"] == "" || mp[0].(map[string]any)["coverUrl"] != thumb {
		t.Fatalf("map %v", mp)
	}

	// ── detail: phone only for owner / staff; view counting ──
	anon := e.do("GET", "/listings/"+id, "", nil)
	e.expect(anon, 200, "detail")
	if anon.body["contactPhone"] != nil || !strings.HasSuffix(anon.body["contactPhoneMasked"].(string), "** **") || anon.body["views"].(float64) != 1 {
		t.Fatalf("anonymous detail %s", anon.raw)
	}
	own := e.do("GET", "/listings/"+id, token, nil)
	images := own.body["images"].([]any)
	if own.body["contactPhone"] != phone || own.body["isOwner"] != true || images[0].(map[string]any)["uploadId"] != uploadID {
		t.Fatalf("owner detail %s", own.raw)
	}
	if r := e.do("POST", "/listings/"+id+"/phone", "", nil); r.body["phone"] != phone {
		t.Fatalf("phone %s", r.raw)
	}

	// ── PATCH keeps amenities; images by listing image id are accepted ──
	imgID := images[0].(map[string]any)["id"].(string)
	patched := e.do("PATCH", "/listings/"+id, token, map[string]any{"price": 120000, "imageIds": []string{imgID}})
	e.expect(patched, 200, "patch")
	after := e.do("GET", "/listings/"+id, token, nil)
	if am := after.body["amenities"].([]any); len(am) != 1 || am[0] != "BALCONY" || after.body["price"].(float64) != 120000 {
		t.Fatalf("after patch %s", after.raw)
	}
	if after.body["status"] != "PENDING" { // re-moderation
		t.Fatalf("status after edit %v", after.body["status"])
	}
	if img := after.body["images"].([]any)[0].(map[string]any); img["uploadId"] != uploadID {
		t.Fatalf("image after patch %v", img)
	}
	if r := e.do("PATCH", "/listings/"+id, token, map[string]any{"floor": 12}); r.status != 400 {
		t.Fatalf("floor > totalFloors accepted: %s", r.raw)
	}
	mine := e.do("GET", "/me/listings", token, nil)
	if mine.body["total"].(float64) != 1 {
		t.Fatalf("me/listings %s", mine.raw)
	}

	// ── favorites, report, saved search ──
	e.expect(e.do("POST", "/admin/listings/"+id+"/approve", admin, nil), 200, "re-approve")
	other := e.otpLogin("+99450"+fmt.Sprint(1_000_000+rand.Intn(8_999_999)), "Other")
	e.expect(e.do("POST", "/favorites/"+id, other, nil), 200, "fav")
	e.expect(e.do("POST", "/favorites/"+id, other, nil), 200, "fav twice")
	if ids := e.do("GET", "/favorites/ids", other, nil).arr(); len(ids) != 1 || ids[0] != id {
		t.Fatalf("fav ids %v", ids)
	}
	if r := e.do("GET", "/listings/"+id, other, nil); r.body["isFavorite"] != true || r.body["favoritesCount"].(float64) != 1 {
		t.Fatalf("fav detail %s", r.raw)
	}
	e.expect(e.do("POST", "/listings/"+id+"/report", other, map[string]any{"reason": "FAKE"}), 200, "report")
	ss := e.do("POST", "/saved-searches", other, map[string]any{"name": "Yasamal", "query": map[string]any{"cityId": "baku", "rooms": []int{2}, "page": 3}})
	e.expect(ss, 201, "saved search")
	if _, ok := ss.body["query"].(map[string]any)["page"]; ok || ss.body["notify"] != true {
		t.Fatalf("saved search %s", ss.raw)
	}
	ssID := ss.body["id"].(string)
	if r := e.do("PATCH", "/saved-searches/"+ssID, other, map[string]any{"name": "Renamed", "notify": false}); r.body["name"] != "Renamed" || r.body["notify"] != false {
		t.Fatalf("patch saved search %s", r.raw)
	}
	e.expect(e.do("PATCH", "/saved-searches/"+ssID, token, map[string]any{"name": "x"}), 404, "foreign saved search")
	if _, err := e.d.Pool.Exec(ctx, `update saved_searches set last_checked_at = now() - interval '1 hour', notify = true where id = $1`, ssID); err != nil {
		t.Fatal(err)
	}
	if ok, err := e.d.Jobs.RunNow(ctx, "saved-searches.matcher"); !ok || err != nil {
		t.Fatalf("matcher %v %v", ok, err)
	}
	if l := e.do("GET", "/saved-searches", other, nil).arr(); len(l) != 1 || l[0].(map[string]any)["newMatches"].(float64) != 1 {
		t.Fatalf("matcher result %v", l)
	}

	// ── expiry cron ──
	if _, err := e.d.Pool.Exec(ctx, `update listings set expires_at = now() + interval '2 days' where id = $1`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := e.d.Jobs.RunNow(ctx, "listings.expiry"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.d.Jobs.RunNow(ctx, "listings.expiry"); err != nil { // de-duplicated
		t.Fatal(err)
	}
	if _, err := e.d.Pool.Exec(ctx, `update listings set expires_at = now() - interval '1 minute' where id = $1`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := e.d.Jobs.RunNow(ctx, "listings.expiry"); err != nil {
		t.Fatal(err)
	}
	e.d.Bus.Wait()
	var expiring, expired int
	_ = e.d.Pool.QueryRow(ctx, `select count(*) filter (where type = 'LISTING_EXPIRING'), count(*) filter (where type = 'LISTING_EXPIRED')
		from notifications where data->>'listingId' = $1`, id).Scan(&expiring, &expired)
	if expiring != 1 || expired != 1 {
		t.Fatalf("expiry notifications: expiring=%d expired=%d", expiring, expired)
	}
	renewed := e.do("POST", "/listings/"+id+"/actions", token, map[string]any{"action": "RENEW"})
	e.expect(renewed, 200, "renew")
	if renewed.body["status"] != "ACTIVE" {
		t.Fatalf("renew %s", renewed.raw)
	}

	// ── quota: third paid-deal listing → DRAFT; ListingsAPI.MarkListingFeePaid → PENDING ──
	up2 := e.upload(token, jpegBytes(300, 200), "image/jpeg")
	e.expect(e.do("POST", "/listings", token, listingBody(marker+"b", phone, up2.body["id"].(string))), 201, "second listing")
	up3 := e.upload(token, jpegBytes(300, 200), "image/jpeg")
	third := e.do("POST", "/listings", token, listingBody(marker+"c", phone, up3.body["id"].(string)))
	if third.body["status"] != "DRAFT" || third.body["requiresPayment"] != true {
		t.Fatalf("third listing %s", third.raw)
	}
	thirdID := third.body["id"].(string)
	e.expect(e.do("POST", "/admin/listings/"+thirdID+"/approve", admin, nil), 400, "approve unpaid")
	if err := e.d.Listings.MarkListingFeePaid(ctx, e.d.Pool, thirdID); err != nil {
		t.Fatal(err)
	}
	if err := e.d.Listings.SetVerified(ctx, e.d.Pool, thirdID, true); err != nil {
		t.Fatal(err)
	}
	if r := e.do("GET", "/listings/"+thirdID, token, nil); r.body["status"] != "PENDING" || r.body["isVerified"] != true {
		t.Fatalf("after fee paid %s", r.raw)
	}

	// ── admin: user detail, wallet adjust without the money module, reports ──
	userID := e.do("GET", "/auth/me", token, nil).body["id"].(string)
	if r := e.do("GET", "/admin/users/"+userID, admin, nil); r.status != 200 || len(r.body["listings"].([]any)) != 3 {
		t.Fatalf("admin user detail %s", r.raw)
	}
	if e.d.Wallet == nil {
		r := e.do("POST", "/admin/users/"+userID+"/wallet-adjust", admin, map[string]any{"amount": 500, "reason": "compensation"})
		if r.status != 503 || r.body["code"] != "PAYMENT_PROVIDER_UNAVAILABLE" {
			t.Fatalf("wallet adjust %s", r.raw)
		}
	}
	if r := e.do("GET", "/admin/reports?status=OPEN", admin, nil); r.body["total"].(float64) != 1 {
		t.Fatalf("reports %s", r.raw)
	}

	// ── delete = archive ──
	removed := e.do("DELETE", "/listings/"+id, token, nil)
	if removed.status != 200 || string(bytes.TrimSpace(removed.raw)) != `{"ok":true}` {
		t.Fatalf("delete %s", removed.raw)
	}
	if r := e.do("GET", "/listings/"+id, token, nil); r.body["status"] != "ARCHIVED" {
		t.Fatalf("after delete %s", r.raw)
	}
	e.expect(e.do("GET", "/listings/not-a-uuid", "", nil), 400, "malformed uuid")
	e.expect(e.do("DELETE", "/users/me", token, nil), 200, "delete account")
}

func TestContentAndAgencies(t *testing.T) {
	e := newEnv(t)
	admin := e.adminToken()
	page := map[string]any{"title": map[string]string{"az": "Haqqımızda", "ru": "О нас", "en": "About"},
		"body": map[string]string{"az": "## A", "ru": "## Б", "en": "## C"}}
	e.expect(e.do("PUT", "/admin/pages/about", admin, page), 200, "upsert page")
	e.expect(e.do("PUT", "/admin/pages/Bad_Slug", admin, page), 400, "bad slug")
	if l := e.do("GET", "/pages?locale=en", "", nil).arr(); len(l) != 1 || l[0].(map[string]any)["title"] != "About" {
		t.Fatalf("pages %v", l)
	}
	if r := e.do("GET", "/pages/about", "", nil); r.body["body"].(map[string]any)["ru"] != "## Б" {
		t.Fatalf("page %s", r.raw)
	}
	b := e.do("POST", "/admin/banners", admin, map[string]any{"placement": "HOME_TOP", "title": "Promo", "imageUrl": "https://x.az/a.jpg", "linkUrl": "https://x.az"})
	e.expect(b, 201, "banner")
	bid := b.body["id"].(string)
	if l := e.do("GET", "/banners?placement=HOME_TOP", "", nil).arr(); len(l) != 1 || l[0].(map[string]any)["impressions"].(float64) != 1 {
		t.Fatalf("banners %v", l)
	}
	e.expect(e.do("POST", "/banners/"+bid+"/click", "", nil), 200, "click")
	if r := e.do("PATCH", "/admin/banners/"+bid, admin, map[string]any{"active": false}); r.body["active"] != false || r.body["clicks"].(float64) != 1 {
		t.Fatalf("patch banner %s", r.raw)
	}

	owner := e.otpLogin("+99470"+fmt.Sprint(1_000_000+rand.Intn(8_999_999)), "Agency Owner")
	ag := e.do("POST", "/agencies", owner, map[string]any{"name": "Test Əmlak", "type": "AGENCY"})
	e.expect(ag, 201, "create agency")
	if ag.body["slug"] != "test-emlak" {
		t.Fatalf("agency %s", ag.raw)
	}
	e.expect(e.do("POST", "/agencies", owner, map[string]any{"name": "Again", "type": "AGENCY"}), 409, "second agency")
	agentPhone := "+99477" + fmt.Sprint(1_000_000+rand.Intn(8_999_999))
	e.otpLogin(agentPhone, "Agent")
	r := e.do("POST", "/agencies/me/members", owner, map[string]any{"login": agentPhone})
	if r.status != 403 || r.body["code"] != "AGENT_LIMIT_REACHED" {
		t.Fatalf("member without plan: %s", r.raw)
	}
	if r := e.do("GET", "/agencies/me/stats?days=7", owner, nil); len(r.body["daily"].([]any)) != 7 {
		t.Fatalf("stats %s", r.raw)
	}
	if r := e.do("PATCH", "/admin/agencies/"+ag.body["id"].(string), admin, map[string]any{"verified": true}); r.body["verified"] != true {
		t.Fatalf("verify agency %s", r.raw)
	}
	if r := e.do("POST", "/mortgage/leads", "", map[string]any{"name": "Lead", "phone": "0501234567", "price": 100000, "downPayment": 20000, "termYears": 10}); r.status != 201 || r.body["id"] == nil {
		t.Fatalf("lead %s", r.raw)
	}
	if r := e.do("GET", "/admin/stats/overview", admin, nil); r.body["users"].(map[string]any)["total"].(float64) < 3 {
		t.Fatalf("overview %s", r.raw)
	}
	if l := e.do("GET", "/admin/stats/listings?days=5", admin, nil).arr(); len(l) != 5 {
		t.Fatalf("listing stats %v", l)
	}
	if r := e.do("GET", "/admin/audit-logs", admin, nil); r.body["total"].(float64) < 3 {
		t.Fatalf("audit %s", r.raw)
	}
}
