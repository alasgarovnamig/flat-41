// Package config loads runtime configuration from the environment (and an optional .env file).
// Variable names are identical to the former NestJS API so existing .env files and docker-compose keep working.
package config

import (
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	Env            string
	IsProd         bool
	Port           int
	APIPublicURL   string // public base URL of this API (upload URLs, bank return URL)
	APIInternalURL string // URL the bank uses for server-to-server webhooks (docker: http://api:4000)
	WebURL         string
	AdminURL       string
	CORSOrigins    []string
	DatabaseURL    string

	JWT struct {
		AccessSecret   string
		RefreshSecret  string
		AccessTTL      int // seconds
		RefreshTTLDays int
	}
	Storage struct {
		Driver    string // local | s3
		UploadDir string
		S3        struct{ Endpoint, Bucket, Region, AccessKey, SecretKey, PublicURL string }
	}
	SMS struct {
		Provider   string
		OTPDevCode string
	}
	Payments struct {
		Provider string
		MockBank struct{ URL, PublicURL, MerchantID, Secret string }
	}
	Push struct {
		Provider        string
		ExpoAccessToken string
	}
	Mail       struct{ Provider, From, SMTPURL string }
	Admin      struct{ Email, Password string }
	SeedImages string // "local" → generated placeholder photos
}

func str(k, d string) string {
	if v, ok := os.LookupEnv(k); ok && v != "" {
		return v
	}
	return d
}

func num(k string, d int) int {
	if v, err := strconv.Atoi(os.Getenv(k)); err == nil {
		return v
	}
	return d
}

// Load reads .env (if present, never overriding real env vars) and returns the configuration.
func Load() *Config {
	_ = godotenv.Load()
	c := &Config{}
	c.Env = str("NODE_ENV", str("APP_ENV", "development"))
	c.IsProd = c.Env == "production"
	c.Port = num("PORT", 4000)
	c.APIPublicURL = strings.TrimRight(str("API_PUBLIC_URL", "http://localhost:4000"), "/")
	c.APIInternalURL = strings.TrimRight(str("API_INTERNAL_URL", c.APIPublicURL), "/")
	c.WebURL = strings.TrimRight(str("WEB_URL", "http://localhost:3000"), "/")
	c.AdminURL = strings.TrimRight(str("ADMIN_URL", "http://localhost:3001"), "/")
	for _, o := range strings.Split(str("CORS_ORIGINS", "*"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			c.CORSOrigins = append(c.CORSOrigins, o)
		}
	}
	c.DatabaseURL = str("DATABASE_URL", "postgres://evtap:evtap@localhost:5432/evtap")

	c.JWT.AccessSecret = str("JWT_ACCESS_SECRET", "dev-access-secret")
	c.JWT.RefreshSecret = str("JWT_REFRESH_SECRET", "dev-refresh-secret")
	c.JWT.AccessTTL = num("JWT_ACCESS_TTL", 900)
	c.JWT.RefreshTTLDays = num("JWT_REFRESH_TTL_DAYS", 30)

	c.Storage.Driver = str("STORAGE_DRIVER", "local")
	c.Storage.UploadDir = str("UPLOAD_DIR", "./uploads")
	c.Storage.S3.Endpoint = os.Getenv("S3_ENDPOINT")
	c.Storage.S3.Bucket = os.Getenv("S3_BUCKET")
	c.Storage.S3.Region = str("S3_REGION", "auto")
	c.Storage.S3.AccessKey = os.Getenv("S3_ACCESS_KEY")
	c.Storage.S3.SecretKey = os.Getenv("S3_SECRET_KEY")
	c.Storage.S3.PublicURL = os.Getenv("S3_PUBLIC_URL")

	c.SMS.Provider = str("SMS_PROVIDER", "console")
	c.SMS.OTPDevCode = os.Getenv("OTP_DEV_CODE")

	c.Payments.Provider = str("PAYMENT_PROVIDER", "mockbank")
	c.Payments.MockBank.URL = strings.TrimRight(str("MOCKBANK_URL", "http://localhost:4100"), "/")
	c.Payments.MockBank.PublicURL = strings.TrimRight(str("MOCKBANK_PUBLIC_URL", c.Payments.MockBank.URL), "/")
	c.Payments.MockBank.MerchantID = str("MOCKBANK_MERCHANT_ID", "evtap")
	c.Payments.MockBank.Secret = str("MOCKBANK_SECRET", "evtap-mockbank-secret")

	c.Push.Provider = str("PUSH_PROVIDER", "console")
	c.Push.ExpoAccessToken = os.Getenv("EXPO_ACCESS_TOKEN")
	c.Mail.Provider = str("MAIL_PROVIDER", "console")
	c.Mail.From = str("MAIL_FROM", "EvTap <no-reply@evtap.az>")
	c.Mail.SMTPURL = os.Getenv("SMTP_URL")

	c.Admin.Email = str("ADMIN_EMAIL", "admin@evtap.az")
	c.Admin.Password = str("ADMIN_PASSWORD", "Admin12345!")
	c.SeedImages = os.Getenv("SEED_IMAGES")
	return c
}
