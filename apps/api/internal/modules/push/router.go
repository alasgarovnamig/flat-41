package push

import (
	"context"
	"log/slog"
	"sync"

	"github.com/alasgarovnamig/evtap/api/internal/config"
)

// NativeRouter routes each message by token / push_tokens.platform:
// ExponentPushToken[...] → Expo, ios → APNs, android / web → FCM. A nil provider means "not configured":
// those messages are skipped with a warning.
type NativeRouter struct {
	Expo Provider
	APNs Provider
	FCM  Provider
}

func (r *NativeRouter) Name() string { return "native" }

// Route returns the provider for one message (nil when not configured).
func (r *NativeRouter) Route(m Message) (Provider, string) {
	switch {
	case IsExpoToken(m.To):
		return r.Expo, "expo"
	case m.Platform == "ios":
		return r.APNs, "apns"
	default: // android, web (FCM issues web registration tokens too)
		return r.FCM, "fcm"
	}
}

func (r *NativeRouter) Send(ctx context.Context, msgs []Message) Result {
	groups := map[string][]Message{}
	providers := map[string]Provider{}
	for _, m := range msgs {
		p, name := r.Route(m)
		if p == nil {
			slog.Warn("push: provider not configured, message skipped", "provider", name, "platform", m.Platform)
			continue
		}
		groups[name] = append(groups[name], m)
		providers[name] = p
	}
	var (
		mu  sync.Mutex
		wg  sync.WaitGroup
		res Result
	)
	for name, batch := range groups {
		wg.Add(1)
		go func(p Provider, batch []Message) {
			defer wg.Done()
			r := p.Send(ctx, batch)
			mu.Lock()
			res.add(r)
			mu.Unlock()
		}(providers[name], batch)
	}
	wg.Wait()
	return res
}

func (r *NativeRouter) CollectReceipts(ctx context.Context) Result {
	if rc, ok := r.Expo.(ReceiptCollector); ok && r.Expo != nil {
		return rc.CollectReceipts(ctx)
	}
	return Result{}
}

// FromConfig builds the provider for PUSH_PROVIDER: console (default) | expo | native.
// A misconfigured native sub-provider is logged and disabled; it never prevents startup.
func FromConfig(c *config.Config) Provider {
	switch c.Push.Provider {
	case "expo":
		return NewExpo(c.Push.ExpoAccessToken)
	case "native":
		r := &NativeRouter{Expo: NewExpo(c.Push.ExpoAccessToken)}
		if c.Push.APNs.KeyP8 != "" {
			if p, err := NewAPNs(c.Push.APNs.KeyID, c.Push.APNs.TeamID, c.Push.APNs.KeyP8, c.Push.APNs.Topic, c.Push.APNs.Sandbox); err != nil {
				slog.Error("push: APNs disabled", "err", err)
			} else {
				r.APNs = p
			}
		} else {
			slog.Warn("push: APNS_KEY_P8 not set — iOS push disabled")
		}
		if c.Push.FCMServiceAccountJSON != "" {
			if p, err := NewFCM([]byte(c.Push.FCMServiceAccountJSON)); err != nil {
				slog.Error("push: FCM disabled", "err", err)
			} else {
				r.FCM = p
			}
		} else {
			slog.Warn("push: FCM_SERVICE_ACCOUNT_JSON not set — Android push disabled")
		}
		return r
	default:
		return ConsoleProvider{}
	}
}
