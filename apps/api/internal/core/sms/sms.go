// Package sms sends text messages. Provider interface so a real gateway (LSIM, Twilio, Infobip…) can be plugged in.
package sms

import (
	"context"
	"log/slog"
)

type Provider interface {
	Send(ctx context.Context, phone, text string) error
}

type consoleProvider struct{}

func (consoleProvider) Send(_ context.Context, phone, text string) error {
	slog.Info("SMS →", "phone", phone, "text", text)
	return nil
}

// New returns the provider configured by SMS_PROVIDER (only "console" for now).
func New(provider string) Provider {
	switch provider {
	default:
		return consoleProvider{}
	}
}
