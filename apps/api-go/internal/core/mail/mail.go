// Package mail sends transactional e-mail (future: password reset, e-mail verification).
// MAIL_PROVIDER = console (default, logs) | smtp (stub: logs a warning and drops the mail, like the former API).
package mail

import (
	"context"
	"log/slog"
)

type Message struct {
	To      string
	Subject string
	Text    string
	HTML    string // optional
}

type Provider interface {
	Name() string
	Send(ctx context.Context, from string, m Message) error
}

// ConsoleProvider logs the mail (development).
type ConsoleProvider struct{}

func (ConsoleProvider) Name() string { return "console" }
func (ConsoleProvider) Send(_ context.Context, from string, m Message) error {
	slog.Info("mail:console", "from", from, "to", m.To, "subject", m.Subject, "text", m.Text)
	return nil
}

// SMTPProvider is a stub — wire a real transport (net/smtp with SMTP_URL) here when needed. It does not send.
type SMTPProvider struct{ URL string }

func (SMTPProvider) Name() string { return "smtp" }
func (SMTPProvider) Send(_ context.Context, _ string, m Message) error {
	slog.Warn("mail:smtp not implemented — dropping mail", "to", m.To, "subject", m.Subject)
	return nil
}

type Service struct {
	From     string
	Provider Provider
}

// New picks the provider by name (smtp | anything else → console).
func New(provider, from, smtpURL string) *Service {
	if from == "" {
		from = "EvTap <no-reply@evtap.az>"
	}
	var p Provider = ConsoleProvider{}
	if provider == "smtp" {
		p = SMTPProvider{URL: smtpURL}
	}
	return &Service{From: from, Provider: p}
}

func (s *Service) Send(ctx context.Context, m Message) error { return s.Provider.Send(ctx, s.From, m) }
