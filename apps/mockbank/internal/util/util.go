// Package util holds small helpers shared by the mock bank: ids, money formatting,
// URL validation/encoding and JavaScript-compatible string helpers (the contract was
// defined by the former Node implementation, so a few JS semantics are mirrored here).
package util

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"math/big"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf16"
	"unicode/utf8"
)

func randomBytes(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return b
}

func randomInt(min, max int) int {
	n, err := rand.Int(rand.Reader, big.NewInt(int64(max-min)))
	if err != nil {
		panic(err)
	}
	return min + int(n.Int64())
}

// NewID returns prefix_ + hex(random bytes), e.g. ord_2b9f… (12 bytes by default).
func NewID(prefix string, bytes int) string {
	return prefix + "_" + hex.EncodeToString(randomBytes(bytes))
}

// NewNonce returns 18 random bytes as base64url (24 chars).
func NewNonce() string { return base64.RawURLEncoding.EncodeToString(randomBytes(18)) }

// NewRRN returns a 12-digit retrieval reference number.
func NewRRN() string {
	var sb strings.Builder
	sb.WriteString(strconv.Itoa(randomInt(1, 10)))
	for i := 0; i < 11; i++ {
		sb.WriteString(strconv.Itoa(randomInt(0, 10)))
	}
	return sb.String()
}

// NewApprovalCode returns a 6-char issuer approval code, e.g. "A1B2C3".
func NewApprovalCode() string {
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"
	b := make([]byte, 6)
	for i := range b {
		b[i] = alphabet[randomInt(0, len(alphabet))]
	}
	return string(b)
}

type symbol struct {
	sym    string
	before bool
}

var symbols = map[string]symbol{
	"AZN": {"₼", false},
	"USD": {"$", true},
	"EUR": {"€", true},
	"GEL": {"₾", false},
}

// FormatMoney formats minor units: 1500 AZN → "15.00 ₼", 1500 USD → "$15.00".
func FormatMoney(minor int64, currency string) string {
	neg := minor < 0
	if neg {
		minor = -minor
	}
	whole := strconv.FormatInt(minor/100, 10)
	// thousands separated by a space
	var sb strings.Builder
	for i, c := range whole {
		if i > 0 && (len(whole)-i)%3 == 0 {
			sb.WriteByte(' ')
		}
		sb.WriteRune(c)
	}
	major := sb.String() + "." + leftPad(strconv.FormatInt(minor%100, 10), 2)
	if neg {
		major = "-" + major
	}
	s, ok := symbols[currency]
	if !ok {
		return major + " " + currency
	}
	if s.before {
		return s.sym + major
	}
	return major + " " + s.sym
}

func leftPad(s string, n int) string {
	for len(s) < n {
		s = "0" + s
	}
	return s
}

var majorRe = regexp.MustCompile(`^(\d{1,9})(?:\.(\d{1,2}))?$`)

// ParseMajorAmount parses "5", "5.5" or "5,50" into minor units; ok=false when invalid.
func ParseMajorAmount(value string) (int64, bool) {
	v := strings.Replace(JSTrim(value), ",", ".", 1)
	m := majorRe.FindStringSubmatch(v)
	if m == nil {
		return 0, false
	}
	whole, _ := strconv.ParseInt(m[1], 10, 64)
	frac := m[2]
	for len(frac) < 2 {
		frac += "0"
	}
	f, _ := strconv.ParseInt(frac, 10, 64)
	return whole*100 + f, true
}

var forbiddenSchemes = map[string]bool{"javascript": true, "data": true, "vbscript": true, "file": true, "blob": true}
var schemeRe = regexp.MustCompile(`^[a-z][a-z0-9+.-]*$`)

// IsValidURL accepts an absolute http(s) URL with a host or — when allowAppScheme — a custom
// app scheme such as evtap://… (never javascript:, data:, vbscript:, file:, blob:).
func IsValidURL(value string, allowAppScheme bool) bool {
	if JSLen(value) > 2048 {
		return false
	}
	v := strings.TrimFunc(value, func(r rune) bool { return r <= 0x20 })
	u, err := url.Parse(v)
	if err != nil || u.Scheme == "" {
		return false
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme == "http" || scheme == "https" {
		return u.Host != "" && u.Hostname() != ""
	}
	return allowAppScheme && !forbiddenSchemes[scheme] && schemeRe.MatchString(scheme)
}

// FormEncode encodes a value exactly like URLSearchParams (application/x-www-form-urlencoded):
// space → "+", unreserved = ALPHA / DIGIT / "*" / "-" / "." / "_".
func FormEncode(s string) string {
	const hexd = "0123456789ABCDEF"
	var sb strings.Builder
	for _, b := range []byte(toWellFormed(s)) {
		switch {
		case b >= 'a' && b <= 'z', b >= 'A' && b <= 'Z', b >= '0' && b <= '9', b == '*', b == '-', b == '.', b == '_':
			sb.WriteByte(b)
		case b == ' ':
			sb.WriteByte('+')
		default:
			sb.WriteByte('%')
			sb.WriteByte(hexd[b>>4])
			sb.WriteByte(hexd[b&15])
		}
	}
	return sb.String()
}

// KV is an ordered query parameter.
type KV struct{ Key, Value string }

// QueryString serialises ordered params like URLSearchParams.toString().
func QueryString(params ...KV) string {
	parts := make([]string, 0, len(params))
	for _, p := range params {
		parts = append(parts, FormEncode(p.Key)+"="+FormEncode(p.Value))
	}
	return strings.Join(parts, "&")
}

// AppendQuery appends query params to a URL string, using "&" when it already has a query
// (fragment preserved).
func AppendQuery(rawURL string, params ...KV) string {
	base, hash := rawURL, ""
	if i := strings.IndexByte(rawURL, '#'); i >= 0 {
		base, hash = rawURL[:i], rawURL[i:]
	}
	sep := "?"
	if strings.Contains(base, "?") {
		sep = "&"
		if strings.HasSuffix(base, "?") || strings.HasSuffix(base, "&") {
			sep = ""
		}
	}
	return base + sep + QueryString(params...) + hash
}

// EncodeURL mirrors the `encodeurl` package Express applies to Location headers: characters
// that are not allowed in a URL are percent-encoded, existing %XX escapes are kept.
func EncodeURL(s string) string {
	const hexd = "0123456789ABCDEF"
	isHex := func(c byte) bool {
		return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
	}
	b := []byte(toWellFormed(s))
	var sb strings.Builder
	for i := 0; i < len(b); i++ {
		c := b[i]
		keep := c == '!' || c == '#' || c == '$' || (c >= 0x26 && c <= 0x3B) || c == '=' || (c >= 0x3F && c <= 0x5B) ||
			c == ']' || c == '_' || (c >= 'a' && c <= 'z') || c == '~'
		if c == '%' && i+2 < len(b) && isHex(b[i+1]) && isHex(b[i+2]) {
			keep = true
		}
		if keep {
			sb.WriteByte(c)
			continue
		}
		sb.WriteByte('%')
		sb.WriteByte(hexd[c>>4])
		sb.WriteByte(hexd[c&15])
	}
	return sb.String()
}

// toWellFormed replaces invalid UTF-8 with U+FFFD.
func toWellFormed(s string) string {
	if utf8.ValidString(s) {
		return s
	}
	var sb strings.Builder
	for _, r := range s {
		sb.WriteRune(r)
	}
	return sb.String()
}

// SanitizeText makes arbitrary bytes storable in a Postgres TEXT column (valid UTF-8, no NUL).
func SanitizeText(s string) string {
	return strings.ReplaceAll(toWellFormed(s), "\x00", "�")
}

// JSLen is String.prototype.length (UTF-16 code units).
func JSLen(s string) int {
	n := 0
	for _, r := range s {
		n += utf16.RuneLen(r)
	}
	return n
}

// JSSlice is s.slice(0, n) in UTF-16 code units (never splits a surrogate pair).
func JSSlice(s string, n int) string {
	units := 0
	for i, r := range s {
		w := utf16.RuneLen(r)
		if units+w > n {
			return s[:i]
		}
		units += w
	}
	return s
}

func isJSSpace(r rune) bool { return unicode.IsSpace(r) || r == 0xFEFF }

// JSTrim is String.prototype.trim().
func JSTrim(s string) string { return strings.TrimFunc(s, isJSSpace) }

// CollapseSpaces replaces every run of JS whitespace (\s+) with a single space.
func CollapseSpaces(s string) string {
	var sb strings.Builder
	inSpace := false
	for _, r := range s {
		if isJSSpace(r) {
			if !inSpace {
				sb.WriteByte(' ')
			}
			inSpace = true
			continue
		}
		inSpace = false
		sb.WriteRune(r)
	}
	return sb.String()
}

// DigitsOnly removes every non [0-9] character.
func DigitsOnly(s string) string {
	var sb strings.Builder
	for i := 0; i < len(s); i++ {
		if s[i] >= '0' && s[i] <= '9' {
			sb.WriteByte(s[i])
		}
	}
	return sb.String()
}
