// Package db owns the PostgreSQL connection pool, migrations and transaction helpers.
package db

import (
	"context"
	"embed"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// Querier is satisfied by *pgxpool.Pool and pgx.Tx, so helpers can run inside or outside a transaction.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 20
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("database ping: %w", err)
	}
	return pool, nil
}

// Migrate applies all embedded goose migrations.
func Migrate(pool *pgxpool.Pool) error {
	goose.SetBaseFS(migrationsFS)
	if err := goose.SetDialect("postgres"); err != nil {
		return err
	}
	sqlDB := stdlib.OpenDBFromPool(pool)
	defer sqlDB.Close()
	return goose.Up(sqlDB, "migrations")
}

// WithTx runs fn inside a transaction (commit on nil error, rollback otherwise).
// If q is already a transaction it is reused, so services can be composed.
func WithTx(ctx context.Context, q Querier, fn func(tx pgx.Tx) error) error {
	if tx, ok := q.(pgx.Tx); ok {
		return fn(tx)
	}
	pool, ok := q.(*pgxpool.Pool)
	if !ok {
		return errors.New("db.WithTx: unsupported querier")
	}
	return pgx.BeginFunc(ctx, pool, fn)
}

// IsUniqueViolation reports whether err is a Postgres unique_violation (23505).
func IsUniqueViolation(err error) bool {
	var pg *pgconn.PgError
	return errors.As(err, &pg) && pg.Code == "23505"
}

// IsNoRows reports whether err means "no rows in result set".
func IsNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }
