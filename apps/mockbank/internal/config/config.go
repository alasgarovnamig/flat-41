// Package config loads the mock bank configuration from environment variables
// (same variables as the former Node implementation).
package config

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

// MerchantSeed is one entry of the MERCHANTS env (id:secret:displayName).
type MerchantSeed struct {
	ID     string
	Secret string
	Name   string
}

// Config is the runtime configuration.
type Config struct {
	Env    string
	IsProd bool
	Port   int
	// PublicURL is the public base URL of the bank (paymentUrl, checkout links). No trailing slash.
	PublicURL   string
	DatabaseURL string
	Merchants   []MerchantSeed
	AdminUser   string
	AdminPass   string
	// OrderTTLMinutes: minutes before an unpaid order becomes EXPIRED.
	OrderTTLMinutes float64
	// WebhookRetryScale multiplies the webhook retry schedule (e.g. 0.01 in tests).
	WebhookRetryScale float64
	// WebhookTimeout is the per-attempt webhook HTTP timeout.
	WebhookTimeout time.Duration
	// SchedulerInterval: how often the background loop (webhook retries + expiry) runs.
	SchedulerInterval time.Duration
	// SignatureTolerance: maximum allowed clock skew for signed merchant requests.
	SignatureTolerance time.Duration
	// LogLevel: debug | info | warn | error | silent.
	LogLevel string
}

// ParseMerchants parses "id:secret:name,id2:secret2:name2".
func ParseMerchants(raw string) ([]MerchantSeed, error) {
	var out []MerchantSeed
	for _, entry := range strings.Split(raw, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		parts := strings.Split(entry, ":")
		id := ""
		secret := ""
		if len(parts) > 0 {
			id = parts[0]
		}
		if len(parts) > 1 {
			secret = parts[1]
		}
		if id == "" || secret == "" {
			return nil, fmt.Errorf("invalid MERCHANTS entry %q (expected id:secret:name)", entry)
		}
		name := ""
		if len(parts) > 2 {
			name = strings.TrimSpace(strings.Join(parts[2:], ":"))
		}
		if name == "" {
			name = strings.TrimSpace(id)
		}
		out = append(out, MerchantSeed{ID: strings.TrimSpace(id), Secret: strings.TrimSpace(secret), Name: name})
	}
	return out, nil
}

func num(env map[string]string, key string, fallback float64) (float64, error) {
	v, ok := env[key]
	if !ok || v == "" {
		return fallback, nil
	}
	n, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	if err != nil || math.IsInf(n, 0) || math.IsNaN(n) {
		return 0, fmt.Errorf("invalid numeric env value %q for %s", v, key)
	}
	return n, nil
}

func ms(v float64) time.Duration { return time.Duration(v * float64(time.Millisecond)) }

// Load builds a Config from an env map (use FromOS for the process environment).
func Load(env map[string]string) (*Config, error) {
	get := func(key, fallback string) string {
		if v, ok := env[key]; ok {
			return v
		}
		return fallback
	}
	appEnv := get("APP_ENV", "")
	if appEnv == "" {
		appEnv = get("NODE_ENV", "development")
	}
	port, err := num(env, "PORT", 4100)
	if err != nil {
		return nil, err
	}
	logLevel := get("LOG_LEVEL", "")
	if logLevel == "" {
		logLevel = "info"
		if appEnv == "test" {
			logLevel = "silent"
		}
	}
	publicURL, ok := env["PUBLIC_URL"]
	if !ok {
		publicURL, ok = env["MOCKBANK_PUBLIC_URL"]
	}
	if !ok {
		publicURL = fmt.Sprintf("http://localhost:%d", int(port))
	}
	merchants, err := ParseMerchants(get("MERCHANTS", "evtap:evtap-mockbank-secret:EvTap"))
	if err != nil {
		return nil, err
	}
	ttl, err := num(env, "ORDER_TTL_MINUTES", 30)
	if err != nil {
		return nil, err
	}
	scale, err := num(env, "WEBHOOK_RETRY_SCALE", 1)
	if err != nil {
		return nil, err
	}
	timeout, err := num(env, "WEBHOOK_TIMEOUT_MS", 10_000)
	if err != nil {
		return nil, err
	}
	interval, err := num(env, "SCHEDULER_INTERVAL_MS", 1_000)
	if err != nil {
		return nil, err
	}
	return &Config{
		Env:                appEnv,
		IsProd:             appEnv == "production",
		Port:               int(port),
		PublicURL:          strings.TrimRight(publicURL, "/"),
		DatabaseURL:        get("DATABASE_URL", "postgres://evtap:evtap@localhost:5432/mockbank"),
		Merchants:          merchants,
		AdminUser:          get("ADMIN_USER", "admin"),
		AdminPass:          get("ADMIN_PASSWORD", "admin"),
		OrderTTLMinutes:    ttl,
		WebhookRetryScale:  scale,
		WebhookTimeout:     ms(timeout),
		SchedulerInterval:  ms(interval),
		SignatureTolerance: 5 * time.Minute,
		LogLevel:           logLevel,
	}, nil
}

// MergeDotEnv adds KEY=VALUE pairs from a .env file's contents to env without overriding
// variables that are already set (like `node --env-file-if-exists`).
func MergeDotEnv(env map[string]string, contents string) {
	for _, line := range strings.Split(contents, "\n") {
		line = strings.TrimSpace(strings.TrimSuffix(line, "\r"))
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		line = strings.TrimPrefix(line, "export ")
		key, value, ok := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !ok || key == "" {
			continue
		}
		value = strings.TrimSpace(value)
		if n := len(value); n >= 2 && (value[0] == '"' || value[0] == '\'' || value[0] == '`') && value[n-1] == value[0] {
			quote := value[0]
			value = value[1 : n-1]
			if quote == '"' {
				value = strings.ReplaceAll(value, `\n`, "\n")
			}
		} else if i := strings.Index(value, " #"); i >= 0 {
			value = strings.TrimSpace(value[:i])
		}
		if _, exists := env[key]; !exists {
			env[key] = value
		}
	}
}

// FromOS converts os.Environ() output into a map.
func FromOS(environ []string) map[string]string {
	m := make(map[string]string, len(environ))
	for _, kv := range environ {
		if i := strings.IndexByte(kv, '='); i > 0 {
			m[kv[:i]] = kv[i+1:]
		}
	}
	return m
}
