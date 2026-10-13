package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/alasgarovnamig/evtap/api/internal/config"
	"github.com/alasgarovnamig/evtap/api/internal/core/settings"
	"github.com/alasgarovnamig/evtap/api/internal/core/sms"
	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
)

const (
	otpTTL         = 5 * time.Minute
	otpResend      = 60 * time.Second
	otpMaxAttempts = 5
)

type Service struct {
	pool     *pgxpool.Pool
	cfg      *config.Config
	signer   *Signer
	sms      sms.Provider
	settings *settings.Service
}

func NewService(pool *pgxpool.Pool, cfg *config.Config, signer *Signer, s sms.Provider, st *settings.Service) *Service {
	return &Service{pool: pool, cfg: cfg, signer: signer, sms: s, settings: st}
}

type SessionMeta struct{ UserAgent, IP *string }

// AuthResponse DTO.
type AuthResponse struct {
	AccessToken  string  `json:"accessToken"`
	RefreshToken string  `json:"refreshToken"`
	ExpiresIn    int     `json:"expiresIn"`
	User         UserDTO `json:"user"`
	IsNew        *bool   `json:"isNew,omitempty"`
}

func sha(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }

func randomToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

// ── OTP ───────────────────────────────────────────────────────────────────

type OTPRequestResult struct {
	Sent       bool    `json:"sent"`
	RetryAfter int     `json:"retryAfter"`
	DevCode    *string `json:"devCode,omitempty"`
}

func (s *Service) RequestOTP(ctx context.Context, phone string) (*OTPRequestResult, error) {
	var last time.Time
	err := s.pool.QueryRow(ctx, `select created_at from otp_codes where phone = $1 order by created_at desc limit 1`, phone).Scan(&last)
	if err == nil && time.Since(last) < otpResend {
		retry := int((otpResend - time.Since(last)).Seconds()) + 1
		return nil, httpx.E(http.StatusTooManyRequests, "OTP_TOO_FREQUENT", fmt.Sprintf("Retry in %ds", retry))
	}
	code := s.cfg.SMS.OTPDevCode
	if code == "" || s.cfg.IsProd {
		n, _ := rand.Int(rand.Reader, big.NewInt(900000))
		code = fmt.Sprint(100000 + n.Int64())
	}
	if _, err := s.pool.Exec(ctx, `insert into otp_codes (phone, code_hash, expires_at) values ($1,$2,$3)`, phone, sha(phone+":"+code), time.Now().Add(otpTTL)); err != nil {
		return nil, err
	}
	if err := s.sms.Send(ctx, phone, "EvTap təsdiq kodu: "+code); err != nil {
		return nil, err
	}
	res := &OTPRequestResult{Sent: true, RetryAfter: int(otpResend.Seconds())}
	if !s.cfg.IsProd {
		res.DevCode = &code
	}
	return res, nil
}

func (s *Service) VerifyOTP(ctx context.Context, phone, code string, name *string, meta SessionMeta) (*AuthResponse, error) {
	var id string
	var hash string
	var attempts int
	err := s.pool.QueryRow(ctx, `select id, code_hash, attempts from otp_codes where phone = $1 and consumed_at is null and expires_at > now()
		order by created_at desc limit 1`, phone).Scan(&id, &hash, &attempts)
	if db.IsNoRows(err) {
		return nil, httpx.BadRequest("OTP_EXPIRED", "Code expired, request a new one")
	} else if err != nil {
		return nil, err
	}
	if attempts >= otpMaxAttempts {
		return nil, httpx.E(http.StatusTooManyRequests, "OTP_TOO_MANY_ATTEMPTS", "Too many attempts")
	}
	if hash != sha(phone+":"+code) {
		_, _ = s.pool.Exec(ctx, `update otp_codes set attempts = attempts + 1 where id = $1`, id)
		return nil, httpx.BadRequest("OTP_INVALID", "Invalid code")
	}
	if _, err := s.pool.Exec(ctx, `update otp_codes set consumed_at = now() where id = $1`, id); err != nil {
		return nil, err
	}
	u, err := ScanUser(s.pool.QueryRow(ctx, `select `+UserColumns+` from users where phone = $1`, phone))
	isNew := false
	switch {
	case db.IsNoRows(err):
		display := "İstifadəçi"
		if name != nil && strings.TrimSpace(*name) != "" {
			display = strings.TrimSpace(*name)
		}
		err = db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
			var e error
			u, e = ScanUser(tx.QueryRow(ctx, `insert into users (phone, name, is_phone_verified) values ($1,$2,true) returning `+UserColumns, phone, display))
			if e != nil {
				return e
			}
			_, e = tx.Exec(ctx, `insert into wallets (user_id) values ($1) on conflict do nothing`, u.ID)
			return e
		})
		if err != nil {
			return nil, err
		}
		isNew = true
	case err != nil:
		return nil, err
	case !u.IsPhoneVerified:
		if u, err = ScanUser(s.pool.QueryRow(ctx, `update users set is_phone_verified = true where id = $1 returning `+UserColumns, u.ID)); err != nil {
			return nil, err
		}
	}
	res, err := s.issue(ctx, u, meta, true)
	if err != nil {
		return nil, err
	}
	res.IsNew = &isNew
	return res, nil
}

// ── Email / password ──────────────────────────────────────────────────────

func (s *Service) Register(ctx context.Context, name, email, password string, phone *string, meta SessionMeta) (*AuthResponse, error) {
	var exists bool
	if err := s.pool.QueryRow(ctx, `select exists(select 1 from users where email = $1 or ($2::text is not null and phone = $2))`, email, phone).Scan(&exists); err != nil {
		return nil, err
	}
	if exists {
		return nil, httpx.Conflict("USER_EXISTS", "User with this email or phone already exists")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	if err != nil {
		return nil, err
	}
	var u *UserRow
	err = db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		var e error
		u, e = ScanUser(tx.QueryRow(ctx, `insert into users (name, email, phone, password_hash) values ($1,$2,$3,$4) returning `+UserColumns, name, email, phone, string(hash)))
		if e != nil {
			return e
		}
		_, e = tx.Exec(ctx, `insert into wallets (user_id) values ($1) on conflict do nothing`, u.ID)
		return e
	})
	if err != nil {
		return nil, err
	}
	res, err := s.issue(ctx, u, meta, true)
	if err != nil {
		return nil, err
	}
	t := true
	res.IsNew = &t
	return res, nil
}

func (s *Service) Login(ctx context.Context, login, password string, meta SessionMeta) (*AuthResponse, error) {
	norm := strings.ToLower(login)
	if !strings.Contains(login, "@") {
		norm = strings.NewReplacer(" ", "", "(", "", ")", "", "-", "").Replace(login)
	}
	u, err := ScanUser(s.pool.QueryRow(ctx, `select `+UserColumns+` from users where email = $1 or phone = $1`, norm))
	if err != nil && !db.IsNoRows(err) {
		return nil, err
	}
	if u == nil || u.PasswordHash == nil || bcrypt.CompareHashAndPassword([]byte(*u.PasswordHash), []byte(password)) != nil {
		return nil, httpx.Unauthorized("INVALID_CREDENTIALS", "Invalid login or password")
	}
	return s.issue(ctx, u, meta, true)
}

// ── Tokens ────────────────────────────────────────────────────────────────

func (s *Service) Refresh(ctx context.Context, refreshToken string, meta SessionMeta) (*AuthResponse, error) {
	var id, userID string
	var expires time.Time
	var revoked *time.Time
	err := s.pool.QueryRow(ctx, `select id, user_id, expires_at, revoked_at from refresh_sessions where token_hash = $1`, sha(refreshToken)).Scan(&id, &userID, &expires, &revoked)
	if db.IsNoRows(err) || (err == nil && expires.Before(time.Now())) {
		return nil, httpx.Unauthorized("REFRESH_INVALID", "Session expired")
	} else if err != nil {
		return nil, err
	}
	if revoked != nil {
		// Reuse of a rotated token → possible theft: revoke every session of the user.
		_, _ = s.pool.Exec(ctx, `update refresh_sessions set revoked_at = now() where user_id = $1 and revoked_at is null`, userID)
		return nil, httpx.Unauthorized("REFRESH_REUSED", "Session revoked")
	}
	if _, err := s.pool.Exec(ctx, `update refresh_sessions set revoked_at = now() where id = $1`, id); err != nil {
		return nil, err
	}
	u, err := ScanUser(s.pool.QueryRow(ctx, `select `+UserColumns+` from users where id = $1`, userID))
	if db.IsNoRows(err) {
		return nil, httpx.Unauthorized("REFRESH_INVALID", "Session expired")
	} else if err != nil {
		return nil, err
	}
	return s.issue(ctx, u, meta, false)
}

func (s *Service) Logout(ctx context.Context, refreshToken string) error {
	_, err := s.pool.Exec(ctx, `update refresh_sessions set revoked_at = now() where token_hash = $1`, sha(refreshToken))
	return err
}

func (s *Service) issue(ctx context.Context, u *UserRow, meta SessionMeta, touchLogin bool) (*AuthResponse, error) {
	if u.Status != "ACTIVE" {
		return nil, httpx.E(http.StatusForbidden, "USER_BLOCKED", "Account is blocked")
	}
	access, err := s.signer.Sign(u.Principal())
	if err != nil {
		return nil, err
	}
	refresh := randomToken(48)
	if _, err := s.pool.Exec(ctx, `insert into refresh_sessions (user_id, token_hash, user_agent, ip, expires_at) values ($1,$2,$3,$4,$5)`,
		u.ID, sha(refresh), meta.UserAgent, meta.IP, time.Now().AddDate(0, 0, s.cfg.JWT.RefreshTTLDays)); err != nil {
		return nil, err
	}
	if touchLogin {
		_, _ = s.pool.Exec(ctx, `update users set last_login_at = now() where id = $1`, u.ID)
	}
	return &AuthResponse{AccessToken: access, RefreshToken: refresh, ExpiresIn: s.signer.TTLSeconds(), User: u.DTO()}, nil
}

// ── Me ────────────────────────────────────────────────────────────────────

type MeWallet struct {
	Balance      int    `json:"balance"`
	BonusBalance int    `json:"bonusBalance"`
	Currency     string `json:"currency"`
}

type Me struct {
	UserDTO
	Wallet              MeWallet               `json:"wallet"`
	Subscription        *settings.Subscription `json:"subscription"`
	Quota               settings.ListingQuota  `json:"quota"`
	UnreadMessages      int                    `json:"unreadMessages"`
	UnreadNotifications int                    `json:"unreadNotifications"`
}

func (s *Service) Me(ctx context.Context, userID string) (*Me, error) {
	u, err := ScanUser(s.pool.QueryRow(ctx, `select `+UserColumns+` from users where id = $1`, userID))
	if db.IsNoRows(err) || (err == nil && u.Status == "DELETED") {
		return nil, httpx.Unauthorized("UNAUTHORIZED", "User not found")
	} else if err != nil {
		return nil, err
	}
	if _, err := s.pool.Exec(ctx, `insert into wallets (user_id) values ($1) on conflict do nothing`, userID); err != nil {
		return nil, err
	}
	me := &Me{UserDTO: u.DTO()}
	if err := s.pool.QueryRow(ctx, `select balance, bonus_balance, currency from wallets where user_id = $1`, userID).
		Scan(&me.Wallet.Balance, &me.Wallet.BonusBalance, &me.Wallet.Currency); err != nil {
		return nil, err
	}
	sub, err := s.settings.ActiveSubscription(ctx, s.pool, userID, u.AgencyID)
	if err != nil {
		return nil, err
	}
	if sub != nil {
		if me.Subscription, err = s.settings.SubscriptionDTO(ctx, s.pool, sub); err != nil {
			return nil, err
		}
	}
	if me.Quota, err = s.settings.Quota(ctx, s.pool, userID, u.AgencyID); err != nil {
		return nil, err
	}
	if err := s.pool.QueryRow(ctx, `select count(*) from messages m join conversations c on c.id = m.conversation_id
		where m.read_at is null and m.sender_id <> $1 and (c.buyer_id = $1 or c.seller_id = $1)`, userID).Scan(&me.UnreadMessages); err != nil {
		return nil, err
	}
	if err := s.pool.QueryRow(ctx, `select count(*) from notifications where user_id = $1 and read_at is null`, userID).Scan(&me.UnreadNotifications); err != nil {
		return nil, err
	}
	return me, nil
}
