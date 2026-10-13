package auth

import (
	"net/http"
	"strings"

	"github.com/alasgarovnamig/evtap/api/internal/httpx"
)

// Authenticate (global middleware) puts the user into the request context when a valid Bearer token is present.
// It never rejects: protected routes add Required / Roles. An invalid token on a protected route → 401 TOKEN_INVALID.
func (s *Signer) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		if strings.HasPrefix(h, "Bearer ") {
			if u, err := s.Verify(strings.TrimPrefix(h, "Bearer ")); err == nil {
				r = r.WithContext(withUser(r.Context(), u))
			} else {
				r = r.WithContext(withUser(r.Context(), nil))
				r.Header.Set("X-Evtap-Token-Invalid", "1")
			}
		}
		next.ServeHTTP(w, r)
	})
}

// Required rejects anonymous requests with 401.
func Required(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if Current(r) == nil {
			if r.Header.Get("X-Evtap-Token-Invalid") == "1" {
				httpx.WriteError(w, r, httpx.Unauthorized("TOKEN_INVALID", "Invalid or expired token"))
				return
			}
			httpx.WriteError(w, r, httpx.Unauthorized("UNAUTHORIZED", "Authentication required"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Roles requires one of the roles. ADMIN implicitly satisfies MODERATOR.
//
//	r.With(auth.Roles("MODERATOR")).Get(...)   // "[admin]" endpoints (moderator or admin)
//	r.With(auth.Roles("ADMIN")).Patch(...)     // "[ADMIN]" endpoints
func Roles(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return Required(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u := Current(r)
			for _, role := range roles {
				if u.Role == role || (u.Role == "ADMIN" && role == "MODERATOR") {
					next.ServeHTTP(w, r)
					return
				}
			}
			httpx.WriteError(w, r, httpx.Forbidden("Insufficient role"))
		}))
	}
}
