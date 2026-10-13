package listings

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"time"

	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/mkt"
)

// ExpiringNoticeDays: owners are warned this many days before expiresAt.
const ExpiringNoticeDays = 3

// RunExpiry (hourly): ACTIVE → EXPIRED past expiresAt; warn owners 3 days before (once per expiresAt value).
func (s *Service) RunExpiry(ctx context.Context) error {
	now := time.Now()
	expired, err := s.Expire(ctx, now)
	if err != nil {
		return err
	}
	warned, err := s.WarnExpiring(ctx, now)
	if err != nil {
		return err
	}
	if expired > 0 || warned > 0 {
		slog.Info("listings expiry", "expired", expired, "warned", warned)
	}
	return nil
}

func (s *Service) Expire(ctx context.Context, now time.Time) (int, error) {
	rows, err := s.d.Pool.Query(ctx, `update listings set status = 'EXPIRED', updated_at = now()
		where status = 'ACTIVE' and expires_at <= $1 returning id, owner_id, title`, now)
	if err != nil {
		return 0, err
	}
	type item struct{ id, owner, title string }
	var list []item
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.id, &it.owner, &it.title); err != nil {
			rows.Close()
			return 0, err
		}
		list = append(list, it)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	for _, it := range list {
		if _, err := s.d.Notify.Notify(ctx, it.owner, "LISTING_EXPIRED", "Elanın müddəti bitdi",
			fmt.Sprintf(`"%s" elanı deaktiv edildi. "Yenilə" düyməsi ilə onu yenidən aktivləşdirə bilərsiniz.`, it.title),
			map[string]any{"listingId": it.id}); err != nil {
			return 0, err
		}
	}
	return len(list), nil
}

func (s *Service) WarnExpiring(ctx context.Context, now time.Time) (int, error) {
	// The notification's data.expiresAt de-duplicates: a renewed listing (new expiresAt) is warned again.
	rows, err := s.d.Pool.Query(ctx, `select l.id, l.owner_id, l.title, l.expires_at from listings l
		where l.status = 'ACTIVE' and l.expires_at > $1 and l.expires_at <= $2
		and not exists (select 1 from notifications n where n.user_id = l.owner_id and n.type = 'LISTING_EXPIRING'
			and n.data->>'listingId' = l.id::text
			and abs(extract(epoch from ((n.data->>'expiresAt')::timestamptz - l.expires_at))) < 1)`, now, mkt.AddDays(now, ExpiringNoticeDays))
	if err != nil {
		return 0, err
	}
	type item struct {
		id, owner, title string
		expires          time.Time
	}
	var list []item
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.id, &it.owner, &it.title, &it.expires); err != nil {
			rows.Close()
			return 0, err
		}
		list = append(list, it)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	for _, it := range list {
		days := int(math.Max(1, math.Ceil(float64(it.expires.Sub(now).Milliseconds())/86_400_000)))
		if _, err := s.d.Notify.Notify(ctx, it.owner, "LISTING_EXPIRING", "Elanın müddəti bitir",
			fmt.Sprintf(`"%s" elanının müddəti %d gün sonra bitəcək. Elanı yeniləməyi unutmayın.`, it.title, days),
			map[string]any{"listingId": it.id, "expiresAt": httpx.ISO(it.expires)}); err != nil {
			return 0, err
		}
	}
	return len(list), nil
}
