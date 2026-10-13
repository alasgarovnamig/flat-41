package push

import (
	"context"
	"encoding/json"
	"log/slog"
	"regexp"
)

// Message is one device notification.
type Message struct {
	To       string         // device push token
	Platform string         // push_tokens.platform: ios | android | web
	Title    string         //
	Body     string         //
	Data     map[string]any // deep-link data: { type, notificationId, conversationId, … }
}

// Result reports tokens the provider declared permanently invalid (uninstalled app, revoked permission) → deleted.
type Result struct {
	InvalidTokens []string
}

func (r *Result) add(o Result) { r.InvalidTokens = append(r.InvalidTokens, o.InvalidTokens...) }

// Provider delivers messages. Transport errors are logged by the provider, never returned: push is best-effort.
type Provider interface {
	Name() string
	Send(ctx context.Context, msgs []Message) Result
}

// ReceiptCollector is implemented by providers with delayed delivery receipts (Expo). Called periodically.
type ReceiptCollector interface {
	CollectReceipts(ctx context.Context) Result
}

var expoTokenRe = regexp.MustCompile(`^Expo(nent)?PushToken\[.+\]$`)

// IsExpoToken reports whether t is an Expo push token (ExponentPushToken[...] / ExpoPushToken[...]).
func IsExpoToken(t string) bool { return expoTokenRe.MatchString(t) }

// ConsoleProvider only logs (development default).
type ConsoleProvider struct{}

func (ConsoleProvider) Name() string { return "console" }

func (ConsoleProvider) Send(_ context.Context, msgs []Message) Result {
	for _, m := range msgs {
		data, _ := json.Marshal(m.Data)
		slog.Info("push:console", "to", truncate(m.To, 32), "platform", m.Platform, "title", m.Title, "body", truncate(m.Body, 60), "data", string(data))
	}
	return Result{}
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

// stringData converts data values to strings (FCM `data` and similar maps only accept strings):
// strings stay as-is, everything else is JSON-encoded. nil values are dropped.
func stringData(data map[string]any) map[string]string {
	out := make(map[string]string, len(data))
	for k, v := range data {
		switch t := v.(type) {
		case nil:
			continue
		case string:
			out[k] = t
		default:
			b, err := json.Marshal(t)
			if err != nil {
				continue
			}
			out[k] = string(b)
		}
	}
	return out
}

// parallel runs fn for every message with at most n concurrent calls and merges the results.
func parallel(ctx context.Context, msgs []Message, n int, fn func(ctx context.Context, m Message) (invalid bool)) Result {
	if n < 1 {
		n = 1
	}
	type out struct {
		token   string
		invalid bool
	}
	jobs := make(chan Message)
	results := make(chan out)
	for i := 0; i < n && i < len(msgs); i++ {
		go func() {
			for m := range jobs {
				results <- out{m.To, fn(ctx, m)}
			}
		}()
	}
	go func() {
		defer close(jobs)
		for _, m := range msgs {
			jobs <- m
		}
	}()
	var res Result
	for range msgs {
		if o := <-results; o.invalid {
			res.InvalidTokens = append(res.InvalidTokens, o.token)
		}
	}
	return res
}
