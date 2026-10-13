package messaging

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/alasgarovnamig/evtap/api/internal/core/events"
	"github.com/alasgarovnamig/evtap/api/internal/core/notify"
	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
)

const (
	// MessagesPerMinute is the anti-spam cap per sender (across all conversations).
	MessagesPerMinute = 30
	// NewMessageNotifyWindow: at most one NEW_MESSAGE notification (→ push) per conversation per recipient.
	NewMessageNotifyWindow = 10 * time.Minute
	previewLen             = 140
)

// ── DTOs (types.ts) ──

type Message struct {
	ID             string  `json:"id"`
	ConversationID string  `json:"conversationId"`
	SenderID       string  `json:"senderId"`
	Body           string  `json:"body"`
	CreatedAt      string  `json:"createdAt"`
	ReadAt         *string `json:"readAt"`
}

// GetSenderID lets the realtime module route `message:new` to the sender's other connections.
func (m *Message) GetSenderID() string { return m.SenderID }

type ConversationListing struct {
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	CoverURL    *string `json:"coverUrl"`
	Price       int64   `json:"price"`
	Currency    string  `json:"currency"`
	PricePeriod string  `json:"pricePeriod"`
	Status      string  `json:"status"`
}

type OtherUser struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	AvatarURL *string `json:"avatarUrl"`
}

type Conversation struct {
	ID          string              `json:"id"`
	Listing     ConversationListing `json:"listing"`
	OtherUser   OtherUser           `json:"otherUser"`
	LastMessage *Message            `json:"lastMessage"`
	UnreadCount int                 `json:"unreadCount"`
	UpdatedAt   string              `json:"updatedAt"`
}

type convRow struct {
	ID, ListingID, BuyerID, SellerID string
	LastMessageAt                    time.Time
}

func (c *convRow) otherID(userID string) string {
	if c.BuyerID == userID {
		return c.SellerID
	}
	return c.BuyerID
}

const convCols = `id::text, listing_id::text, buyer_id::text, seller_id::text, last_message_at`

func scanConv(row pgx.Row) (*convRow, error) {
	var c convRow
	err := row.Scan(&c.ID, &c.ListingID, &c.BuyerID, &c.SellerID, &c.LastMessageAt)
	return &c, err
}

const msgCols = `id::text, conversation_id::text, sender_id::text, body, created_at, read_at`

func scanMessage(row pgx.Row) (*Message, error) {
	var m Message
	var created time.Time
	var read *time.Time
	if err := row.Scan(&m.ID, &m.ConversationID, &m.SenderID, &m.Body, &created, &read); err != nil {
		return nil, err
	}
	m.CreatedAt, m.ReadAt = httpx.ISO(created), httpx.ISOPtr(read)
	return &m, nil
}

type Service struct {
	pool   db.Querier
	bus    *events.Bus
	notify *notify.Service
}

func NewService(pool db.Querier, bus *events.Bus, n *notify.Service) *Service {
	return &Service{pool: pool, bus: bus, notify: n}
}

// ───────── Conversations ─────────

func (s *Service) List(ctx context.Context, userID string, pa httpx.PageArgs) (httpx.Paginated[Conversation], error) {
	var total int
	if err := s.pool.QueryRow(ctx, `select count(*) from conversations where buyer_id = $1 or seller_id = $1`, userID).Scan(&total); err != nil {
		return httpx.Paginated[Conversation]{}, err
	}
	rows, err := s.pool.Query(ctx, `select `+convCols+` from conversations where buyer_id = $1 or seller_id = $1
		order by last_message_at desc, id desc limit $2 offset $3`, userID, pa.Limit, pa.Offset)
	if err != nil {
		return httpx.Paginated[Conversation]{}, err
	}
	convs, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (*convRow, error) { return scanConv(r) })
	if err != nil {
		return httpx.Paginated[Conversation]{}, err
	}
	dtos, err := s.toDTOs(ctx, userID, convs)
	if err != nil {
		return httpx.Paginated[Conversation]{}, err
	}
	return httpx.NewPage(dtos, total, pa.Page, pa.PageSize), nil
}

// Get returns one conversation for a participant (404 unknown, 403 not a participant).
func (s *Service) Get(ctx context.Context, userID, conversationID string) (*Conversation, error) {
	conv, err := s.participating(ctx, userID, conversationID)
	if err != nil {
		return nil, err
	}
	dtos, err := s.toDTOs(ctx, userID, []*convRow{conv})
	if err != nil {
		return nil, err
	}
	return &dtos[0], nil
}

// Start (POST /conversations) re-uses the (listing, buyer) conversation, then sends the first message.
func (s *Service) Start(ctx context.Context, userID, listingID, body string) (*Conversation, error) {
	var ownerID, status string
	err := s.pool.QueryRow(ctx, `select owner_id::text, status from listings where id = $1`, listingID).Scan(&ownerID, &status)
	if db.IsNoRows(err) {
		return nil, httpx.NotFound("Listing")
	} else if err != nil {
		return nil, err
	}
	if status == "BLOCKED" {
		return nil, httpx.E(http.StatusForbidden, "LISTING_BLOCKED", "This listing is blocked")
	}
	if ownerID == userID {
		return nil, httpx.BadRequest("CANNOT_MESSAGE_SELF", "You cannot message yourself")
	}
	text, err := cleanOrThrow(body)
	if err != nil {
		return nil, err
	}
	if err := s.assertRecipientAvailable(ctx, ownerID); err != nil {
		return nil, err
	}
	if err := s.assertRateLimit(ctx, userID); err != nil {
		return nil, err
	}
	if _, err := s.pool.Exec(ctx, `insert into conversations (listing_id, buyer_id, seller_id) values ($1,$2,$3) on conflict do nothing`,
		listingID, userID, ownerID); err != nil {
		return nil, err
	}
	conv, err := scanConv(s.pool.QueryRow(ctx, `select `+convCols+` from conversations where listing_id = $1 and buyer_id = $2`, listingID, userID))
	if err != nil {
		return nil, err
	}
	if _, err := s.insertAndDispatch(ctx, conv, userID, text); err != nil {
		return nil, err
	}
	return s.Get(ctx, userID, conv.ID)
}

// Messages returns up to limit messages older than `before` (cursor = oldest message id the client has), newest last.
func (s *Service) Messages(ctx context.Context, userID, conversationID string, before *string, limit int) ([]Message, error) {
	if _, err := s.participating(ctx, userID, conversationID); err != nil {
		return nil, err
	}
	q := `select ` + msgCols + ` from messages where conversation_id = $1`
	args := []any{conversationID, limit}
	if before != nil {
		var ok bool
		if err := s.pool.QueryRow(ctx, `select exists(select 1 from messages where id = $1 and conversation_id = $2)`, *before, conversationID).Scan(&ok); err != nil {
			return nil, err
		}
		if !ok {
			return nil, httpx.BadRequest("INVALID_CURSOR", `Unknown "before" message`)
		}
		// Row comparison inside SQL keeps Postgres' microsecond precision.
		q += ` and (created_at, id) < (select m2.created_at, m2.id from messages m2 where m2.id = $3)`
		args = append(args, *before)
	}
	rows, err := s.pool.Query(ctx, q+` order by created_at desc, id desc limit $2`, args...)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Message, error) {
		m, err := scanMessage(r)
		if err != nil {
			return Message{}, err
		}
		return *m, nil
	})
	if err != nil {
		return nil, err
	}
	out := make([]Message, len(list))
	for i, m := range list { // newest last
		out[len(list)-1-i] = m
	}
	return out, nil
}

func (s *Service) Send(ctx context.Context, userID, conversationID, body string) (*Message, error) {
	conv, err := s.participating(ctx, userID, conversationID)
	if err != nil {
		return nil, err
	}
	text, err := cleanOrThrow(body)
	if err != nil {
		return nil, err
	}
	var status string
	if err := s.pool.QueryRow(ctx, `select status from listings where id = $1`, conv.ListingID).Scan(&status); err != nil && !db.IsNoRows(err) {
		return nil, err
	}
	if status == "BLOCKED" {
		return nil, httpx.E(http.StatusForbidden, "LISTING_BLOCKED", "This listing is blocked")
	}
	if err := s.assertRecipientAvailable(ctx, conv.otherID(userID)); err != nil {
		return nil, err
	}
	if err := s.assertRateLimit(ctx, userID); err != nil {
		return nil, err
	}
	return s.insertAndDispatch(ctx, conv, userID, text)
}

// MarkRead marks every message from the other participant as read and tells them over realtime.
func (s *Service) MarkRead(ctx context.Context, userID, conversationID string) error {
	conv, err := s.participating(ctx, userID, conversationID)
	if err != nil {
		return err
	}
	readAt := time.Now()
	tag, err := s.pool.Exec(ctx, `update messages set read_at = $3 where conversation_id = $1 and sender_id <> $2 and read_at is null`,
		conversationID, userID, readAt)
	if err != nil {
		return err
	}
	if tag.RowsAffected() > 0 {
		s.bus.Publish(events.ConversationRead, events.ConversationReadEvent{
			RecipientID: conv.otherID(userID), ConversationID: conversationID, ReaderID: userID, ReadAt: httpx.ISO(readAt),
		})
	}
	return nil
}

func (s *Service) UnreadCount(ctx context.Context, userID string) (int, error) {
	var n int
	err := s.pool.QueryRow(ctx, `select count(*) from messages m join conversations c on c.id = m.conversation_id
		where m.read_at is null and m.sender_id <> $1 and (c.buyer_id = $1 or c.seller_id = $1)`, userID).Scan(&n)
	return n, err
}

// Participants returns (buyerID, sellerID) of a conversation; ok=false when it does not exist (realtime typing relay).
func (s *Service) Participants(ctx context.Context, conversationID string) (buyerID, sellerID string, ok bool, err error) {
	err = s.pool.QueryRow(ctx, `select buyer_id::text, seller_id::text from conversations where id = $1`, conversationID).Scan(&buyerID, &sellerID)
	if db.IsNoRows(err) {
		return "", "", false, nil
	}
	return buyerID, sellerID, err == nil, err
}

// ───────── internals ─────────

func (s *Service) participating(ctx context.Context, userID, conversationID string) (*convRow, error) {
	conv, err := scanConv(s.pool.QueryRow(ctx, `select `+convCols+` from conversations where id = $1`, conversationID))
	if db.IsNoRows(err) {
		return nil, httpx.NotFound("Conversation")
	} else if err != nil {
		return nil, err
	}
	if conv.BuyerID != userID && conv.SellerID != userID {
		return nil, httpx.Forbidden("Not a participant of this conversation")
	}
	return conv, nil
}

func cleanOrThrow(body string) (string, error) {
	text := Sanitize(body)
	if text == "" {
		return "", httpx.BadRequest("MESSAGE_EMPTY", "Message is empty")
	}
	return text, nil
}

func (s *Service) assertRecipientAvailable(ctx context.Context, recipientID string) error {
	var status string
	err := s.pool.QueryRow(ctx, `select status from users where id = $1`, recipientID).Scan(&status)
	if err != nil && !db.IsNoRows(err) {
		return err
	}
	if db.IsNoRows(err) || status == "DELETED" {
		return httpx.E(http.StatusGone, "RECIPIENT_UNAVAILABLE", "This user is no longer available")
	}
	return nil
}

func (s *Service) assertRateLimit(ctx context.Context, userID string) error {
	var n int
	if err := s.pool.QueryRow(ctx, `select count(*) from messages where sender_id = $1 and created_at > now() - interval '1 minute'`, userID).Scan(&n); err != nil {
		return err
	}
	if n >= MessagesPerMinute {
		return httpx.E(http.StatusTooManyRequests, "RATE_LIMITED", "Too many messages, slow down")
	}
	return nil
}

func (s *Service) insertAndDispatch(ctx context.Context, conv *convRow, senderID, body string) (*Message, error) {
	var msg *Message
	err := db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		var err error
		msg, err = scanMessage(tx.QueryRow(ctx, `insert into messages (conversation_id, sender_id, body) values ($1,$2,$3) returning `+msgCols,
			conv.ID, senderID, body))
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `update conversations set last_message_at = (select created_at from messages where id = $2) where id = $1`, conv.ID, msg.ID)
		return err
	})
	if err != nil {
		return nil, err
	}
	recipientID := conv.otherID(senderID)
	s.bus.Publish(events.MessageCreated, events.MessageCreatedEvent{RecipientID: recipientID, Message: msg})
	// Notification + push are best-effort: never fail the send because of them.
	if err := s.maybeNotify(ctx, recipientID, conv, senderID, msg); err != nil {
		slog.Warn("NEW_MESSAGE notify failed", "conversation", conv.ID, "err", err)
	}
	return msg, nil
}

// maybeNotify sends at most one NEW_MESSAGE notification per conversation per recipient per 10 minutes.
// A transaction-scoped advisory lock serialises concurrent sends so the throttle cannot be raced.
func (s *Service) maybeNotify(ctx context.Context, recipientID string, conv *convRow, senderID string, msg *Message) error {
	return db.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended('new_message:' || $1 || ':' || $2, 0))`, recipientID, conv.ID); err != nil {
			return err
		}
		var recent bool
		if err := tx.QueryRow(ctx, `select exists(select 1 from notifications where user_id = $1 and type = 'NEW_MESSAGE'
			and created_at > $2 and data->>'conversationId' = $3)`, recipientID, time.Now().Add(-NewMessageNotifyWindow), conv.ID).Scan(&recent); err != nil {
			return err
		}
		if recent {
			return nil
		}
		title := "Yeni mesaj"
		var name string
		if err := tx.QueryRow(ctx, `select name from users where id = $1`, senderID).Scan(&name); err == nil && name != "" {
			title = name
		}
		_, err := s.notify.NotifyQ(ctx, tx, recipientID, "NEW_MESSAGE", title, preview(msg.Body, previewLen), map[string]any{
			"conversationId": conv.ID, "listingId": conv.ListingID, "senderId": senderID, "messageId": msg.ID,
		})
		return err
	})
}

// toDTOs builds Conversation DTOs for userID with 5 batched queries (no N+1).
func (s *Service) toDTOs(ctx context.Context, userID string, convs []*convRow) ([]Conversation, error) {
	if len(convs) == 0 {
		return []Conversation{}, nil
	}
	convIDs := make([]string, 0, len(convs))
	listingSet, otherSet := map[string]bool{}, map[string]bool{}
	var listingIDs, otherIDs []string
	for _, c := range convs {
		convIDs = append(convIDs, c.ID)
		if !listingSet[c.ListingID] {
			listingSet[c.ListingID] = true
			listingIDs = append(listingIDs, c.ListingID)
		}
		if o := c.otherID(userID); !otherSet[o] {
			otherSet[o] = true
			otherIDs = append(otherIDs, o)
		}
	}

	listingsByID := map[string]ConversationListing{}
	rows, err := s.pool.Query(ctx, `select l.id::text, l.title, l.price, l.currency, l.price_period, l.status,
			(select i.thumb_url from listing_images i where i.listing_id = l.id order by i."order" asc, i.id asc limit 1)
		from listings l where l.id = any($1::uuid[])`, listingIDs)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var l ConversationListing
		if err := rows.Scan(&l.ID, &l.Title, &l.Price, &l.Currency, &l.PricePeriod, &l.Status, &l.CoverURL); err != nil {
			rows.Close()
			return nil, err
		}
		listingsByID[l.ID] = l
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	type userRow struct {
		name, status string
		avatar       *string
	}
	usersByID := map[string]userRow{}
	rows, err = s.pool.Query(ctx, `select id::text, name, avatar_url, status from users where id = any($1::uuid[])`, otherIDs)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		var u userRow
		if err := rows.Scan(&id, &u.name, &u.avatar, &u.status); err != nil {
			rows.Close()
			return nil, err
		}
		usersByID[id] = u
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	lastByConv := map[string]*Message{}
	rows, err = s.pool.Query(ctx, `select distinct on (conversation_id) `+msgCols+` from messages
		where conversation_id = any($1::uuid[]) order by conversation_id, created_at desc, id desc`, convIDs)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		lastByConv[m.ConversationID] = m
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	unread := map[string]int{}
	rows, err = s.pool.Query(ctx, `select conversation_id::text, count(*)::int from messages
		where conversation_id = any($1::uuid[]) and sender_id <> $2 and read_at is null group by conversation_id`, convIDs, userID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id string
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			rows.Close()
			return nil, err
		}
		unread[id] = n
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]Conversation, 0, len(convs))
	for _, c := range convs {
		otherID := c.otherID(userID)
		other := OtherUser{ID: otherID, Name: "İstifadəçi"}
		if u, ok := usersByID[otherID]; ok {
			other.Name = u.name
			if u.status != "DELETED" {
				other.AvatarURL = u.avatar
			}
		}
		out = append(out, Conversation{
			ID: c.ID, Listing: listingsByID[c.ListingID], OtherUser: other, LastMessage: lastByConv[c.ID],
			UnreadCount: unread[c.ID], UpdatedAt: httpx.ISO(c.LastMessageAt),
		})
	}
	return out, nil
}
