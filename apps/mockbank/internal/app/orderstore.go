package app

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

func isNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// findOrder loads an order (nil when unknown).
func findOrder(ctx context.Context, q Querier, orderID string, forUpdate bool) (*Order, error) {
	sql := `SELECT ` + orderCols + ` FROM orders WHERE id = $1`
	if forUpdate {
		sql += " FOR UPDATE"
	}
	o, err := scanOrder(q.QueryRow(ctx, sql, orderID))
	if isNoRows(err) {
		return nil, nil
	}
	return o, err
}

func findRefunds(ctx context.Context, q Querier, orderID string) ([]Refund, error) {
	rows, err := q.Query(ctx, `SELECT id, order_id, amount, reason, source, created_at FROM refunds WHERE order_id = $1 ORDER BY created_at, id`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Refund
	for rows.Next() {
		var r Refund
		if err := rows.Scan(&r.ID, &r.OrderID, &r.Amount, &r.Reason, &r.Source, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// nowValue as a patch value means "the transaction's now()".
type nowValue struct{}

// set is one column assignment of a transition patch (ordered).
type set struct {
	col   string
	value any
}

// transition is an atomic status change: it only applies when the order is currently in one
// of from. Returns the updated row, or nil when the order was in another state (lost race / invalid).
func transition(ctx context.Context, q Querier, orderID string, from []string, patch ...set) (*Order, error) {
	params := []any{orderID, from}
	sets := make([]string, 0, len(patch)+1)
	for _, p := range patch {
		if _, ok := p.value.(nowValue); ok {
			sets = append(sets, p.col+" = now()")
			continue
		}
		params = append(params, p.value)
		sets = append(sets, fmt.Sprintf("%s = $%d", p.col, len(params)))
	}
	sets = append(sets, "updated_at = now()")
	sql := `UPDATE orders SET ` + strings.Join(sets, ", ") + ` WHERE id = $1 AND status = ANY($2::text[]) RETURNING ` + orderCols
	o, err := scanOrder(q.QueryRow(ctx, sql, params...))
	if isNoRows(err) {
		return nil, nil
	}
	return o, err
}

func loadOrderJSON(ctx context.Context, q Querier, o *Order) (OrderJSON, error) {
	refunds, err := findRefunds(ctx, q, o.ID)
	if err != nil {
		return OrderJSON{}, err
	}
	return ToOrderJSON(o, refunds), nil
}

// addEvent appends to the order timeline.
func addEvent(ctx context.Context, q Querier, orderID, typ, message string, data map[string]any) error {
	var payload *string
	if data != nil {
		b, err := MarshalJSON(data)
		if err != nil {
			return err
		}
		s := string(b)
		payload = &s
	}
	_, err := q.Exec(ctx, `INSERT INTO events (order_id, type, message, data) VALUES ($1, $2, $3, $4::jsonb)`, orderID, typ, message, payload)
	return err
}
