package config

import (
	"reflect"
	"testing"
	"time"
)

func TestDefaults(t *testing.T) {
	c, err := Load(map[string]string{})
	if err != nil {
		t.Fatal(err)
	}
	if c.Port != 4100 || c.PublicURL != "http://localhost:4100" || c.Env != "development" || c.IsProd ||
		c.DatabaseURL != "postgres://evtap:evtap@localhost:5432/mockbank" || c.AdminUser != "admin" || c.AdminPass != "admin" ||
		c.OrderTTLMinutes != 30 || c.WebhookRetryScale != 1 || c.WebhookTimeout != 10*time.Second ||
		c.SchedulerInterval != time.Second || c.SignatureTolerance != 5*time.Minute || c.LogLevel != "info" {
		t.Fatalf("defaults %+v", c)
	}
	if !reflect.DeepEqual(c.Merchants, []MerchantSeed{{ID: "evtap", Secret: "evtap-mockbank-secret", Name: "EvTap"}}) {
		t.Fatalf("merchants %+v", c.Merchants)
	}
}

func TestEnv(t *testing.T) {
	c, err := Load(map[string]string{
		"NODE_ENV": "production", "PORT": "4150", "MOCKBANK_PUBLIC_URL": "https://bank.example/", "WEBHOOK_RETRY_SCALE": "0.01",
		"MERCHANTS": "a:s1:Shop: One , b:s2", "SCHEDULER_INTERVAL_MS": "40", "WEBHOOK_TIMEOUT_MS": "2000",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !c.IsProd || c.Port != 4150 || c.PublicURL != "https://bank.example" || c.WebhookRetryScale != 0.01 ||
		c.SchedulerInterval != 40*time.Millisecond || c.WebhookTimeout != 2*time.Second {
		t.Fatalf("%+v", c)
	}
	if !reflect.DeepEqual(c.Merchants, []MerchantSeed{{"a", "s1", "Shop: One"}, {"b", "s2", "b"}}) {
		t.Fatalf("merchants %+v", c.Merchants)
	}
	// PUBLIC_URL wins over MOCKBANK_PUBLIC_URL; APP_ENV wins over NODE_ENV; test env is silent.
	c, _ = Load(map[string]string{"PUBLIC_URL": "http://a", "MOCKBANK_PUBLIC_URL": "http://b", "APP_ENV": "test", "NODE_ENV": "production"})
	if c.PublicURL != "http://a" || c.IsProd || c.Env != "test" || c.LogLevel != "silent" {
		t.Fatalf("%+v", c)
	}
	if _, err := Load(map[string]string{"PORT": "abc"}); err == nil {
		t.Fatal("invalid number must fail")
	}
	if _, err := Load(map[string]string{"MERCHANTS": "nosecret"}); err == nil {
		t.Fatal("invalid MERCHANTS must fail")
	}
}

func TestMergeDotEnv(t *testing.T) {
	env := map[string]string{"PORT": "1"}
	MergeDotEnv(env, "# comment\nPORT=2\nexport A=1 # note\nB=\"x y\"\nC='z'\r\n\nD")
	want := map[string]string{"PORT": "1", "A": "1", "B": "x y", "C": "z"}
	if !reflect.DeepEqual(env, want) {
		t.Fatalf("%v", env)
	}
}
