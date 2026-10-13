package auth

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type claims struct {
	Role string  `json:"role"`
	Acc  string  `json:"acc"`
	Ag   *string `json:"ag"`
	jwt.RegisteredClaims
}

// Signer issues and verifies HS256 access tokens (same claims as the former API: sub, role, acc, ag).
type Signer struct {
	secret []byte
	ttl    time.Duration
}

func NewSigner(secret string, ttlSeconds int) *Signer {
	return &Signer{secret: []byte(secret), ttl: time.Duration(ttlSeconds) * time.Second}
}

func (s *Signer) TTLSeconds() int { return int(s.ttl.Seconds()) }

func (s *Signer) Sign(u User) (string, error) {
	now := time.Now()
	c := claims{Role: u.Role, Acc: u.AccountType, Ag: u.AgencyID, RegisteredClaims: jwt.RegisteredClaims{
		Subject: u.ID, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(s.ttl)),
	}}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(s.secret)
}

func (s *Signer) Verify(token string) (*User, error) {
	var c claims
	t, err := jwt.ParseWithClaims(token, &c, func(t *jwt.Token) (any, error) { return s.secret, nil }, jwt.WithValidMethods([]string{"HS256"}))
	if err != nil || !t.Valid {
		return nil, errors.New("invalid token")
	}
	return &User{ID: c.Subject, Role: c.Role, AccountType: c.Acc, AgencyID: c.Ag}, nil
}
