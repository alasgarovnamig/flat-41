package wallet

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
)

// Debit sources (app.WalletOpts.Source).
const (
	BonusFirst = "BONUS_FIRST" // default (purchases): bonus balance is spent before real money
	RealOnly   = "REAL_ONLY"   // only real balance (reversing a top-up, clawing back a payout)
	BonusOnly  = "BONUS_ONLY"  // only bonus balance (revoking a top-up bonus)
)

// Wallet DTO (types.ts).
type Wallet struct {
	Balance      int    `json:"balance"`
	BonusBalance int    `json:"bonusBalance"`
	Currency     string `json:"currency"`
}

// Transaction DTO (WalletTransaction in types.ts).
type Transaction struct {
	ID           string  `json:"id"`
	Type         string  `json:"type"`
	Amount       int     `json:"amount"`
	BalanceAfter int     `json:"balanceAfter"`
	Description  string  `json:"description"`
	PaymentID    *string `json:"paymentId"`
	CreatedAt    string  `json:"createdAt"`
}

// TxRow is a row of wallet_transactions.
type TxRow struct {
	ID           string
	UserID       string
	Type         string
	Amount       int
	BonusAmount  int
	BalanceAfter int
	Description  string
	PaymentID    *string
	BookingID    *string
	ActorID      *string
	CreatedAt    time.Time
}

const txColumns = `id, user_id, type, amount, bonus_amount, balance_after, description, payment_id, booking_id, actor_id, created_at`

func scanTx(row pgx.Row) (*TxRow, error) {
	var t TxRow
	err := row.Scan(&t.ID, &t.UserID, &t.Type, &t.Amount, &t.BonusAmount, &t.BalanceAfter, &t.Description, &t.PaymentID, &t.BookingID, &t.ActorID, &t.CreatedAt)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// DTO maps a ledger row to the API DTO.
func (t *TxRow) DTO() Transaction {
	return Transaction{ID: t.ID, Type: t.Type, Amount: t.Amount, BalanceAfter: t.BalanceAfter, Description: t.Description, PaymentID: t.PaymentID, CreatedAt: httpx.ISO(t.CreatedAt)}
}

// Split is the result of SplitDebit.
type Split struct {
	OK        bool
	FromBonus int
	FromReal  int
}

// SplitDebit splits a debit between bonus and real balance. Pure — exported for tests.
func SplitDebit(balance, bonusBalance, amount int, source string) Split {
	fromBonus := 0
	if source != RealOnly {
		fromBonus = min(bonusBalance, amount)
	}
	fromReal := 0
	if source != BonusOnly {
		fromReal = amount - fromBonus
	}
	return Split{OK: fromBonus+fromReal == amount && fromReal <= balance, FromBonus: fromBonus, FromReal: fromReal}
}

// ErrInsufficientFunds is the 402 returned when the wallet cannot cover a debit.
func ErrInsufficientFunds() *httpx.AppError {
	return httpx.E(http.StatusPaymentRequired, "INSUFFICIENT_FUNDS", "Insufficient wallet balance")
}

// Service is the user wallet (AZN): real balance + non-refundable bonus balance. Every change is a row in
// wallet_transactions written in the same transaction as the balance update, with the wallet row locked
// (SELECT … FOR UPDATE). It implements app.WalletAPI.
type Service struct{ db db.Querier }

// NewService is stateless apart from the pool, so other money packages may construct their own instance.
func NewService(q db.Querier) *Service { return &Service{db: q} }

var _ app.WalletAPI = (*Service)(nil)

type walletRow struct{ balance, bonus int }

func (s *Service) lock(ctx context.Context, tx pgx.Tx, userID string) (walletRow, error) {
	var w walletRow
	if _, err := tx.Exec(ctx, `insert into wallets (user_id) values ($1) on conflict do nothing`, userID); err != nil {
		return w, err
	}
	err := tx.QueryRow(ctx, `select balance, bonus_balance from wallets where user_id = $1 for update`, userID).Scan(&w.balance, &w.bonus)
	return w, err
}

// Get returns the user's wallet (created on first access).
func (s *Service) Get(ctx context.Context, q db.Querier, userID string) (Wallet, error) {
	if q == nil {
		q = s.db
	}
	if _, err := q.Exec(ctx, `insert into wallets (user_id) values ($1) on conflict do nothing`, userID); err != nil {
		return Wallet{}, err
	}
	var w Wallet
	err := q.QueryRow(ctx, `select balance, bonus_balance, currency from wallets where user_id = $1`, userID).Scan(&w.Balance, &w.BonusBalance, &w.Currency)
	return w, err
}

// Transactions lists the ledger, newest first. Ledger rows are stamped with clock_timestamp() (not the transaction
// start time) so several rows written by one transaction (TOPUP + BONUS) keep their order.
func (s *Service) Transactions(ctx context.Context, userID string, pg httpx.PageArgs) (httpx.Paginated[Transaction], error) {
	rows, err := s.db.Query(ctx, `select `+txColumns+` from wallet_transactions where user_id = $1 order by created_at desc, id desc limit $2 offset $3`,
		userID, pg.Limit, pg.Offset)
	if err != nil {
		return httpx.Paginated[Transaction]{}, err
	}
	defer rows.Close()
	items := []Transaction{}
	for rows.Next() {
		t, err := scanTx(rows)
		if err != nil {
			return httpx.Paginated[Transaction]{}, err
		}
		items = append(items, t.DTO())
	}
	if err := rows.Err(); err != nil {
		return httpx.Paginated[Transaction]{}, err
	}
	var total int
	if err := s.db.QueryRow(ctx, `select count(*) from wallet_transactions where user_id = $1`, userID).Scan(&total); err != nil {
		return httpx.Paginated[Transaction]{}, err
	}
	return httpx.NewPage(items, total, pg.Page, pg.PageSize), nil
}

func assertAmount(amount int) error {
	if amount <= 0 {
		return httpx.BadRequest("INVALID_AMOUNT", "Amount must be a positive integer (minor units)")
	}
	return nil
}

// Credit implements app.WalletAPI.
func (s *Service) Credit(ctx context.Context, q db.Querier, userID string, amount int, txType, description string, opts app.WalletOpts) error {
	_, err := s.CreditTx(ctx, q, userID, amount, txType, description, opts)
	return err
}

// CreditTx adds money and returns the ledger row. opts.BonusAmount (≤ amount) goes to the bonus balance; for
// txType BONUS with no explicit bonus amount the whole amount is bonus.
func (s *Service) CreditTx(ctx context.Context, q db.Querier, userID string, amount int, txType, description string, opts app.WalletOpts) (*TxRow, error) {
	if err := assertAmount(amount); err != nil {
		return nil, err
	}
	bonus := opts.BonusAmount
	if bonus == 0 && txType == "BONUS" {
		bonus = amount
	}
	if bonus < 0 || bonus > amount {
		return nil, httpx.BadRequest("INVALID_AMOUNT", "Invalid bonus amount")
	}
	if q == nil {
		q = s.db
	}
	var out *TxRow
	err := db.WithTx(ctx, q, func(tx pgx.Tx) error {
		w, err := s.lock(ctx, tx, userID)
		if err != nil {
			return err
		}
		balance := w.balance + (amount - bonus)
		bonusBalance := w.bonus + bonus
		if _, err := tx.Exec(ctx, `update wallets set balance = $2, bonus_balance = $3, updated_at = now() where user_id = $1`, userID, balance, bonusBalance); err != nil {
			return err
		}
		out, err = scanTx(tx.QueryRow(ctx, `insert into wallet_transactions (user_id, type, amount, bonus_amount, balance_after, description, payment_id, booking_id, actor_id, created_at)
			values ($1,$2,$3,$4,$5,$6,$7,$8,$9, clock_timestamp()) returning `+txColumns,
			userID, txType, amount, bonus, balance+bonusBalance, description, opts.PaymentID, opts.BookingID, opts.ActorID))
		return err
	})
	return out, err
}

// Debit implements app.WalletAPI.
func (s *Service) Debit(ctx context.Context, q db.Querier, userID string, amount int, description string, opts app.WalletOpts) error {
	_, err := s.DebitTx(ctx, q, userID, amount, description, opts)
	return err
}

// DebitTx takes money (bonus first by default) and returns the ledger row (negative amount).
// Returns 402 INSUFFICIENT_FUNDS when the wallet cannot cover it.
func (s *Service) DebitTx(ctx context.Context, q db.Querier, userID string, amount int, description string, opts app.WalletOpts) (*TxRow, error) {
	if err := assertAmount(amount); err != nil {
		return nil, err
	}
	if q == nil {
		q = s.db
	}
	txType := opts.TxType
	if txType == "" {
		txType = "SPEND"
	}
	var out *TxRow
	err := db.WithTx(ctx, q, func(tx pgx.Tx) error {
		w, err := s.lock(ctx, tx, userID)
		if err != nil {
			return err
		}
		sp := SplitDebit(w.balance, w.bonus, amount, opts.Source)
		if !sp.OK {
			return ErrInsufficientFunds()
		}
		balance := w.balance - sp.FromReal
		bonusBalance := w.bonus - sp.FromBonus
		if _, err := tx.Exec(ctx, `update wallets set balance = $2, bonus_balance = $3, updated_at = now() where user_id = $1`, userID, balance, bonusBalance); err != nil {
			return err
		}
		out, err = scanTx(tx.QueryRow(ctx, `insert into wallet_transactions (user_id, type, amount, bonus_amount, balance_after, description, payment_id, booking_id, actor_id, created_at)
			values ($1,$2,$3,$4,$5,$6,$7,$8,$9, clock_timestamp()) returning `+txColumns,
			userID, txType, -amount, -sp.FromBonus, balance+bonusBalance, description, opts.PaymentID, opts.BookingID, opts.ActorID))
		return err
	})
	return out, err
}

// RevokeBonus removes up to max from the bonus balance (e.g. the bonus of a refunded top-up). Returns the amount removed.
func (s *Service) RevokeBonus(ctx context.Context, q db.Querier, userID string, maxAmount int, description string, opts app.WalletOpts) (int, error) {
	if maxAmount <= 0 {
		return 0, nil
	}
	if q == nil {
		q = s.db
	}
	removed := 0
	err := db.WithTx(ctx, q, func(tx pgx.Tx) error {
		w, err := s.lock(ctx, tx, userID)
		if err != nil {
			return err
		}
		amount := min(maxAmount, w.bonus)
		if amount <= 0 {
			return nil
		}
		opts.TxType, opts.Source = "BONUS", BonusOnly
		if _, err := s.DebitTx(ctx, tx, userID, amount, description, opts); err != nil {
			return err
		}
		removed = amount
		return nil
	})
	return removed, err
}
