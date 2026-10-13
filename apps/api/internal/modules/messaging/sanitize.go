package messaging

import (
	"regexp"
	"strings"
	"unicode"
)

var (
	crlfRe = regexp.MustCompile(`\r\n?`)
	// C0/C1 control characters except \t (U+0009) and \n (U+000A).
	controlRe = regexp.MustCompile(`[\x{0000}-\x{0008}\x{000B}\x{000C}\x{000E}-\x{001F}\x{007F}-\x{009F}]`)
	// Zero-width chars, bidi marks/embeddings/overrides/isolates, word joiner & invisible operators, BOM.
	invisibleRe  = regexp.MustCompile(`[\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{2064}\x{2066}-\x{2069}\x{FEFF}]`)
	trailingWsRe = regexp.MustCompile(`[ \t]+\n`)
	blankLinesRe = regexp.MustCompile(`\n{3,}`)
)

// Sanitize strips characters that are invisible or can be abused for spoofing / breaking clients:
// C0/C1 control chars (keeps \n and \t), zero-width chars, bidi overrides. Normalises line breaks and
// collapses runs of blank lines. Returns "" when nothing visible remains. (Port of sanitizeMessage.)
func Sanitize(raw string) string {
	s := crlfRe.ReplaceAllString(raw, "\n")
	s = controlRe.ReplaceAllString(s, "")
	s = invisibleRe.ReplaceAllString(s, "")
	s = trailingWsRe.ReplaceAllString(s, "\n")
	s = blankLinesRe.ReplaceAllString(s, "\n\n")
	return strings.TrimFunc(s, unicode.IsSpace)
}

// preview shortens a message body for notification texts (max n characters incl. the ellipsis).
func preview(body string, n int) string {
	r := []rune(body)
	if len(r) <= n {
		return body
	}
	return string(r[:n-1]) + "…"
}
