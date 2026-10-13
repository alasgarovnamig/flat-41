// Package users: profile edit, password change, GDPR account deletion, push tokens and public profiles.
package users

import (
	"context"
	"math"
	"net/http"
	"net/url"
	"time"

	sq "github.com/Masterminds/squirrel"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/mkt"
	"github.com/alasgarovnamig/evtap/api/internal/modules/agencies"
	"github.com/alasgarovnamig/evtap/api/internal/shared"
)

var psql = sq.StatementBuilder.PlaceholderFormat(sq.Dollar)

// PublicUser DTO.
type PublicUser struct {
	ID             string            `json:"id"`
	Name           string            `json:"name"`
	AvatarURL      *string           `json:"avatarUrl"`
	AccountType    string            `json:"accountType"`
	Agency         *agencies.Summary `json:"agency"`
	MemberSince    string            `json:"memberSince"`
	ActiveListings int               `json:"activeListings"`
	Rating         *float64          `json:"rating"`
	ReviewsCount   int               `json:"reviewsCount"`
}

// GetPublicUser builds the PublicUser DTO (404 when the user does not exist). Used by listing detail too.
func GetPublicUser(ctx context.Context, q db.Querier, id string) (*PublicUser, error) {
	var u PublicUser
	var agencyID *string
	var created time.Time
	err := q.QueryRow(ctx, `select id, name, avatar_url, account_type, agency_id, created_at from users where id = $1`, id).
		Scan(&u.ID, &u.Name, &u.AvatarURL, &u.AccountType, &agencyID, &created)
	if db.IsNoRows(err) {
		return nil, httpx.NotFound("User")
	} else if err != nil {
		return nil, err
	}
	u.MemberSince = httpx.ISO(created)
	if agencyID != nil {
		if u.Agency, err = agencies.SummaryByID(ctx, q, *agencyID); err != nil {
			return nil, err
		}
	}
	if err := q.QueryRow(ctx, `select count(*)::int from listings where owner_id = $1 and status = 'ACTIVE'`, id).Scan(&u.ActiveListings); err != nil {
		return nil, err
	}
	var avg *float64
	if err := q.QueryRow(ctx, `select avg(r.rating)::float, count(*)::int from reviews r join listings l on l.id = r.listing_id where l.owner_id = $1`, id).
		Scan(&avg, &u.ReviewsCount); err != nil {
		return nil, err
	}
	if avg != nil {
		v := math.Floor(*avg*10+0.5) / 10
		u.Rating = &v
	}
	return &u, nil
}

type Module struct{ d *app.Deps }

func New(d *app.Deps) *Module { return &Module{d: d} }

func (m *Module) Routes(r chi.Router) {
	r.With(auth.Required).Patch("/users/me", httpx.H(m.updateMe))
	r.With(auth.Required).Post("/users/me/password", httpx.H(m.changePassword))
	r.With(auth.Required).Delete("/users/me", httpx.H(m.deleteMe))
	r.With(auth.Required).Post("/users/me/push-tokens", httpx.H(m.addPushToken))
	r.With(auth.Required).Delete("/users/me/push-tokens/{token}", httpx.H(m.removePushToken))
	r.Get("/users/{id}", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
		id, err := mkt.UUIDParam(r, "id")
		if err != nil {
			return nil, err
		}
		return GetPublicUser(r.Context(), m.d.Pool, id)
	}))
}

func (m *Module) updateMe(w http.ResponseWriter, r *http.Request) (any, error) {
	b, err := mkt.ReadBody(r)
	if err != nil {
		return nil, err
	}
	name := b.Str("name", mkt.S{Trim: true, Min: 2, Max: 80})
	email := b.Str("email", mkt.S{Trim: true, Lower: true, Email: true})
	avatar := b.Str("avatarUrl", mkt.S{Null: true, URL: true})
	locale := b.Str("locale", mkt.S{Enum: shared.Enum.Locales})
	if err := b.Err(); err != nil {
		return nil, err
	}
	ctx := r.Context()
	userID := auth.Current(r).ID
	set := map[string]any{}
	if name.Ok() {
		set["name"] = name.V
	}
	if avatar.Present {
		set["avatar_url"] = avatar.Ptr()
	}
	if locale.Ok() {
		set["locale"] = locale.V
	}
	if email.Ok() {
		var taken bool
		if err := m.d.Pool.QueryRow(ctx, `select exists(select 1 from users where email = $1 and id <> $2)`, email.V, userID).Scan(&taken); err != nil {
			return nil, err
		}
		if taken {
			return nil, httpx.Conflict("EMAIL_TAKEN", "Email is already used by another account")
		}
		var cur *string
		if err := m.d.Pool.QueryRow(ctx, `select email from users where id = $1`, userID).Scan(&cur); err != nil && !db.IsNoRows(err) {
			return nil, err
		}
		if cur == nil || *cur != email.V {
			set["email"] = email.V
			set["is_email_verified"] = false
		}
	}
	var row pgx.Row
	if len(set) > 0 {
		set["updated_at"] = sq.Expr("now()")
		sqlStr, args, err := psql.Update("users").SetMap(set).Where(sq.Eq{"id": userID}).Suffix("returning " + auth.UserColumns).ToSql()
		if err != nil {
			return nil, err
		}
		row = m.d.Pool.QueryRow(ctx, sqlStr, args...)
	} else {
		row = m.d.Pool.QueryRow(ctx, `select `+auth.UserColumns+` from users where id = $1`, userID)
	}
	u, err := auth.ScanUser(row)
	if db.IsNoRows(err) {
		return nil, httpx.NotFound("User")
	} else if err != nil {
		return nil, err
	}
	return u.DTO(), nil
}

func (m *Module) changePassword(w http.ResponseWriter, r *http.Request) (any, error) {
	b, err := mkt.ReadBody(r)
	if err != nil {
		return nil, err
	}
	current := b.Str("currentPassword", mkt.S{})
	next := b.Str("newPassword", mkt.S{Req: true, Min: 8, Max: 100})
	if err := b.Err(); err != nil {
		return nil, err
	}
	ctx := r.Context()
	userID := auth.Current(r).ID
	var hash *string
	err = m.d.Pool.QueryRow(ctx, `select password_hash from users where id = $1`, userID).Scan(&hash)
	if db.IsNoRows(err) {
		return nil, httpx.NotFound("User")
	} else if err != nil {
		return nil, err
	}
	if hash != nil {
		if !current.Ok() || bcrypt.CompareHashAndPassword([]byte(*hash), []byte(current.V)) != nil {
			return nil, httpx.BadRequest("INVALID_PASSWORD", "Current password is incorrect")
		}
	}
	nh, err := bcrypt.GenerateFromPassword([]byte(next.V), 10)
	if err != nil {
		return nil, err
	}
	if _, err := m.d.Pool.Exec(ctx, `update users set password_hash = $2, updated_at = now() where id = $1`, userID, string(nh)); err != nil {
		return nil, err
	}
	return httpx.OK, nil
}

// deleteMe — GDPR / App Store account deletion: anonymise PII, archive listings, revoke sessions & push tokens.
func (m *Module) deleteMe(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	userID := auth.Current(r).ID
	err := db.WithTx(ctx, m.d.Pool, func(tx pgx.Tx) error {
		if _, e := tx.Exec(ctx, `update users set name = 'Silinmiş istifadəçi', phone = null, email = null, password_hash = null, avatar_url = null,
			status = 'DELETED', is_phone_verified = false, is_email_verified = false, updated_at = now() where id = $1`, userID); e != nil {
			return e
		}
		if _, e := tx.Exec(ctx, `update listings set status = 'ARCHIVED', updated_at = now()
			where owner_id = $1 and status in ('DRAFT','PENDING','ACTIVE','REJECTED','EXPIRED')`, userID); e != nil {
			return e
		}
		if _, e := tx.Exec(ctx, `update refresh_sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, userID); e != nil {
			return e
		}
		if _, e := tx.Exec(ctx, `delete from push_tokens where user_id = $1`, userID); e != nil {
			return e
		}
		if _, e := tx.Exec(ctx, `delete from saved_searches where user_id = $1`, userID); e != nil {
			return e
		}
		// Agents leave their agency; an agency owner's agency stays (admins can deal with it).
		tag, e := tx.Exec(ctx, `delete from agency_members where user_id = $1 and role = 'AGENT'`, userID)
		if e != nil {
			return e
		}
		if tag.RowsAffected() > 0 {
			_, e = tx.Exec(ctx, `update users set agency_id = null, updated_at = now() where id = $1`, userID)
		}
		return e
	})
	if err != nil {
		return nil, err
	}
	return httpx.OK, nil
}

func (m *Module) addPushToken(w http.ResponseWriter, r *http.Request) (any, error) {
	b, err := mkt.ReadBody(r)
	if err != nil {
		return nil, err
	}
	token := b.Str("token", mkt.S{Req: true, Min: 10})
	platform := b.Str("platform", mkt.S{Req: true, Enum: []string{"ios", "android", "web"}})
	if err := b.Err(); err != nil {
		return nil, err
	}
	userID := auth.Current(r).ID
	if _, err := m.d.Pool.Exec(r.Context(), `insert into push_tokens (token, user_id, platform) values ($1,$2,$3)
		on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform`, token.V, userID, platform.V); err != nil {
		return nil, err
	}
	return httpx.OK, nil
}

func (m *Module) removePushToken(w http.ResponseWriter, r *http.Request) (any, error) {
	token, err := url.PathUnescape(chi.URLParam(r, "token"))
	if err != nil {
		token = chi.URLParam(r, "token")
	}
	if _, err := m.d.Pool.Exec(r.Context(), `delete from push_tokens where token = $1 and user_id = $2`, token, auth.Current(r).ID); err != nil {
		return nil, err
	}
	return httpx.OK, nil
}
