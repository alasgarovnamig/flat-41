package app

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

// Scheduler is the DB-backed background loop: due webhook retries + order expiry. All state
// lives in Postgres, so pending retries survive restarts; FOR UPDATE SKIP LOCKED keeps several
// instances safe.
type Scheduler struct {
	orders   *OrderService
	webhooks *WebhookService
	interval time.Duration
	log      *slog.Logger

	mu     sync.Mutex
	stop   chan struct{}
	done   chan struct{}
	active bool
}

// Start begins ticking (first tick immediately). No-op when already running.
func (s *Scheduler) Start() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.active {
		return
	}
	s.active = true
	s.stop = make(chan struct{})
	s.done = make(chan struct{})
	go s.loop(s.stop, s.done)
}

// Stop stops ticking and waits for a running tick to finish.
func (s *Scheduler) Stop() {
	s.mu.Lock()
	if !s.active {
		s.mu.Unlock()
		return
	}
	s.active = false
	close(s.stop)
	done := s.done
	s.mu.Unlock()
	<-done
}

func (s *Scheduler) loop(stop, done chan struct{}) {
	defer close(done)
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-stop:
			return
		case <-timer.C:
		}
		s.Tick(context.Background())
		timer.Reset(s.interval)
	}
}

// Tick runs one pass (also handy in tests).
func (s *Scheduler) Tick(ctx context.Context) {
	if n, err := s.orders.ExpireDue(ctx, 50); err != nil {
		s.log.Error("expiry pass failed", "err", err.Error())
	} else if n > 0 {
		s.log.Info("orders expired", "count", n)
	}
	if _, err := s.webhooks.ProcessDue(ctx, 20); err != nil {
		s.log.Error("webhook pass failed", "err", err.Error())
	}
}
