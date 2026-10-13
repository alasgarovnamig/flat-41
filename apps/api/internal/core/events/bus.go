// Package events is a tiny in-process pub/sub used for domain events (replaces @nestjs/event-emitter).
// Subscribers run asynchronously; a panicking subscriber is logged and does not affect the publisher.
package events

import (
	"log/slog"
	"sync"
)

// Topics (payload types in parentheses).
const (
	NotificationCreated = "notification.created" // NotificationCreatedEvent
	MessageCreated      = "message.created"      // MessageCreatedEvent
	ConversationRead    = "conversation.read"    // ConversationReadEvent
	PaymentUpdated      = "payment.updated"      // PaymentUpdatedEvent
)

type NotificationCreatedEvent struct {
	UserID       string
	Notification any // DTO (notify.AppNotification)
	SkipPush     bool
}
type MessageCreatedEvent struct {
	RecipientID string
	Message     any // messaging DTO incl. conversationId
}
type ConversationReadEvent struct {
	RecipientID, ConversationID, ReaderID, ReadAt string
}
type PaymentUpdatedEvent struct {
	UserID  string
	Payment any // payments DTO
}

type Bus struct {
	mu   sync.RWMutex
	subs map[string][]func(any)
	wg   sync.WaitGroup
}

func NewBus() *Bus { return &Bus{subs: map[string][]func(any){}} }

func (b *Bus) Subscribe(topic string, fn func(payload any)) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.subs[topic] = append(b.subs[topic], fn)
}

func (b *Bus) Publish(topic string, payload any) {
	b.mu.RLock()
	handlers := append([]func(any){}, b.subs[topic]...)
	b.mu.RUnlock()
	for _, h := range handlers {
		b.wg.Add(1)
		go func(h func(any)) {
			defer b.wg.Done()
			defer func() {
				if r := recover(); r != nil {
					slog.Error("event subscriber panic", "topic", topic, "panic", r)
				}
			}()
			h(payload)
		}(h)
	}
}

// Wait blocks until in-flight subscribers finish (tests, graceful shutdown).
func (b *Bus) Wait() { b.wg.Wait() }
