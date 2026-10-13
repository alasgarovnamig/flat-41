package app

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/alasgarovnamig/evtap/mockbank/internal/util"
)

// TokenService manages saved cards. Only token, mask, brand, merchant and test flags are
// stored — never a PAN or CVV.
type TokenService struct{ db *pgxpool.Pool }

const tokenCols = `token, merchant_id, mask, brand, customer_id, force_insufficient_funds, created_at, last_used_at`

func scanToken(row rowScanner) (*CardToken, error) {
	var t CardToken
	if err := row.Scan(&t.Token, &t.MerchantID, &t.Mask, &t.Brand, &t.CustomerID, &t.ForceInsufficientFunds, &t.CreatedAt, &t.LastUsedAt); err != nil {
		return nil, err
	}
	return &t, nil
}

// Create stores a new token and returns it.
func (s *TokenService) Create(ctx context.Context, q Querier, merchantID, mask, brand string, customerID *string) (string, error) {
	token := util.NewID("tok", 16)
	_, err := q.Exec(ctx, `INSERT INTO card_tokens (token, merchant_id, mask, brand, customer_id) VALUES ($1, $2, $3, $4, $5)`,
		token, merchantID, mask, brand, customerID)
	return token, err
}

// Find returns the merchant's token (nil when unknown).
func (s *TokenService) Find(ctx context.Context, q Querier, token, merchantID string, forUpdate bool) (*CardToken, error) {
	sql := `SELECT ` + tokenCols + ` FROM card_tokens WHERE token = $1 AND merchant_id = $2`
	if forUpdate {
		sql += " FOR UPDATE"
	}
	t, err := scanToken(q.QueryRow(ctx, sql, token, merchantID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return t, err
}

// Touch updates last_used_at.
func (s *TokenService) Touch(ctx context.Context, q Querier, token string) error {
	_, err := q.Exec(ctx, `UPDATE card_tokens SET last_used_at = now() WHERE token = $1`, token)
	return err
}

// Delete removes a token (scoped to a merchant when merchantID != ""). Reports whether one was deleted.
func (s *TokenService) Delete(ctx context.Context, token, merchantID string) (bool, error) {
	var err error
	var n int64
	if merchantID != "" {
		tag, e := s.db.Exec(ctx, `DELETE FROM card_tokens WHERE token = $1 AND merchant_id = $2`, token, merchantID)
		n, err = tag.RowsAffected(), e
	} else {
		tag, e := s.db.Exec(ctx, `DELETE FROM card_tokens WHERE token = $1`, token)
		n, err = tag.RowsAffected(), e
	}
	return n > 0, err
}

// SetInsufficientFunds toggles the forced INSUFFICIENT_FUNDS decline for charge-token.
func (s *TokenService) SetInsufficientFunds(ctx context.Context, token string, value bool) (bool, error) {
	tag, err := s.db.Exec(ctx, `UPDATE card_tokens SET force_insufficient_funds = $2 WHERE token = $1`, token, value)
	return tag.RowsAffected() > 0, err
}

// TokenFilter filters the admin token list.
type TokenFilter struct {
	MerchantID string
	Q          string
}

// List returns saved cards (newest first, max 500).
func (s *TokenService) List(ctx context.Context, f TokenFilter) ([]CardToken, error) {
	var where []string
	var params []any
	if f.MerchantID != "" {
		params = append(params, f.MerchantID)
		where = append(where, fmt.Sprintf("merchant_id = $%d", len(params)))
	}
	if f.Q != "" {
		params = append(params, "%"+f.Q+"%")
		n := len(params)
		where = append(where, fmt.Sprintf("(token ILIKE $%d OR mask ILIKE $%d OR customer_id ILIKE $%d)", n, n, n))
	}
	sql := `SELECT ` + tokenCols + ` FROM card_tokens`
	if len(where) > 0 {
		sql += " WHERE " + strings.Join(where, " AND ")
	}
	sql += " ORDER BY created_at DESC LIMIT 500"
	rows, err := s.db.Query(ctx, sql, params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CardToken
	for rows.Next() {
		t, err := scanToken(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}
