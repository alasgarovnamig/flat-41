package auth

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/httprate"

	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/shared"
)

// ── Request bodies (mirror the zod schemas in packages/shared/src/schemas.ts) ──

type otpRequestBody struct {
	Phone string `json:"phone" validate:"required,phone"`
}

func (b *otpRequestBody) Normalize() { b.Phone = shared.NormalizePhone(b.Phone) }

type otpVerifyBody struct {
	Phone string  `json:"phone" validate:"required,phone"`
	Code  string  `json:"code" validate:"required,numeric,min=4,max=6"`
	Name  *string `json:"name" validate:"omitempty,min=2,max=80"`
}

func (b *otpVerifyBody) Normalize() { b.Phone = shared.NormalizePhone(b.Phone) }

type registerBody struct {
	Name     string  `json:"name" validate:"required,min=2,max=80"`
	Email    string  `json:"email" validate:"required,email"`
	Password string  `json:"password" validate:"required,min=8,max=100"`
	Phone    *string `json:"phone" validate:"omitempty,phone"`
}

func (b *registerBody) Normalize() {
	b.Name = strings.TrimSpace(b.Name)
	b.Email = strings.ToLower(strings.TrimSpace(b.Email))
	if b.Phone != nil {
		p := shared.NormalizePhone(*b.Phone)
		b.Phone = &p
	}
}

type loginBody struct {
	Login    string `json:"login" validate:"required,min=3"`
	Password string `json:"password" validate:"required,min=1"`
}

func (b *loginBody) Normalize() { b.Login = strings.TrimSpace(b.Login) }

type refreshBody struct {
	RefreshToken string `json:"refreshToken" validate:"required,min=10"`
}

func meta(r *http.Request) SessionMeta {
	ua := r.UserAgent()
	ip := r.RemoteAddr // chi middleware.RealIP has already resolved X-Forwarded-For
	if i := strings.LastIndex(ip, ":"); i > 0 && !strings.Contains(ip[i:], "]") {
		ip = ip[:i]
	}
	return SessionMeta{UserAgent: &ua, IP: &ip}
}

func limit(n int) func(http.Handler) http.Handler {
	return httprate.Limit(n, time.Minute, httprate.WithKeyFuncs(httprate.KeyByIP),
		httprate.WithLimitHandler(func(w http.ResponseWriter, r *http.Request) {
			httpx.WriteError(w, r, httpx.E(http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests"))
		}))
}

// Routes mounts /auth/*.
func (s *Service) Routes(r chi.Router) {
	r.Route("/auth", func(r chi.Router) {
		r.With(limit(5)).Post("/otp/request", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			var b otpRequestBody
			if err := httpx.Bind(r, &b); err != nil {
				return nil, err
			}
			return s.RequestOTP(r.Context(), b.Phone)
		}))
		r.With(limit(10)).Post("/otp/verify", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			var b otpVerifyBody
			if err := httpx.Bind(r, &b); err != nil {
				return nil, err
			}
			return s.VerifyOTP(r.Context(), b.Phone, b.Code, b.Name, meta(r))
		}))
		r.With(limit(5)).Post("/register", httpx.HS(http.StatusCreated, func(w http.ResponseWriter, r *http.Request) (any, error) {
			var b registerBody
			if err := httpx.Bind(r, &b); err != nil {
				return nil, err
			}
			return s.Register(r.Context(), b.Name, b.Email, b.Password, b.Phone, meta(r))
		}))
		r.With(limit(10)).Post("/login", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			var b loginBody
			if err := httpx.Bind(r, &b); err != nil {
				return nil, err
			}
			return s.Login(r.Context(), b.Login, b.Password, meta(r))
		}))
		r.Post("/refresh", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			var b refreshBody
			if err := httpx.Bind(r, &b); err != nil {
				return nil, err
			}
			return s.Refresh(r.Context(), b.RefreshToken, meta(r))
		}))
		r.With(Required).Post("/logout", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			var b refreshBody
			if err := httpx.Bind(r, &b); err != nil {
				return nil, err
			}
			if err := s.Logout(r.Context(), b.RefreshToken); err != nil {
				return nil, err
			}
			return httpx.OK, nil
		}))
		r.With(Required).Get("/me", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			return s.Me(r.Context(), Current(r).ID)
		}))
	})
}
