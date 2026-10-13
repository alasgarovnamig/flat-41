package app

import (
	"context"
	"log/slog"
	"time"
)

// Start launches every registered job on its own ticker until ctx is cancelled.
func (s *Scheduler) Start(ctx context.Context) {
	for _, j := range s.jobs {
		go func(j job) {
			t := time.NewTicker(j.every)
			defer t.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-t.C:
					s.run(ctx, j)
				}
			}
		}(j)
	}
}

// RunNow executes a job by name synchronously (admin/test hook). Returns false if unknown.
func (s *Scheduler) RunNow(ctx context.Context, name string) (bool, error) {
	for _, j := range s.jobs {
		if j.name == name {
			return true, j.fn(ctx)
		}
	}
	return false, nil
}

func (s *Scheduler) Names() []string {
	out := make([]string, 0, len(s.jobs))
	for _, j := range s.jobs {
		out = append(out, j.name)
	}
	return out
}

func (s *Scheduler) run(ctx context.Context, j job) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("job panic", "job", j.name, "panic", r)
		}
	}()
	start := time.Now()
	if err := j.fn(ctx); err != nil {
		slog.Error("job failed", "job", j.name, "err", err)
		return
	}
	slog.Debug("job done", "job", j.name, "took", time.Since(start))
}
