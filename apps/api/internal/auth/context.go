// Package auth: JWT access tokens, rotating refresh sessions, phone OTP + email/password login, and the
// middleware every module uses (Authenticate / Required / Roles / CurrentUser).
package auth

import (
	"context"
	"net/http"
)

// User is the authenticated principal taken from the access token (no DB hit).
type User struct {
	ID          string  `json:"id"`
	Role        string  `json:"role"` // USER | MODERATOR | ADMIN
	AccountType string  `json:"accountType"`
	AgencyID    *string `json:"agencyId"`
}

func (u *User) IsStaff() bool { return u != nil && (u.Role == "ADMIN" || u.Role == "MODERATOR") }
func (u *User) IsAdmin() bool { return u != nil && u.Role == "ADMIN" }

type ctxKey struct{}

// FromContext returns the authenticated user or nil (public routes without / with invalid token).
func FromContext(ctx context.Context) *User {
	u, _ := ctx.Value(ctxKey{}).(*User)
	return u
}

// Current is a shortcut for FromContext(r.Context()).
func Current(r *http.Request) *User { return FromContext(r.Context()) }

func withUser(ctx context.Context, u *User) context.Context {
	return context.WithValue(ctx, ctxKey{}, u)
}
