package payments

import (
	"net/url"
	"slices"
	"strings"

	"github.com/alasgarovnamig/evtap/api/internal/config"
)

// origin mirrors WHATWG URL#origin for http(s): scheme://host[:port] with default ports dropped.
func origin(u *url.URL) string {
	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if (u.Scheme == "http" && port == "80") || (u.Scheme == "https" && port == "443") {
		port = ""
	}
	if strings.Contains(host, ":") {
		host = "[" + host + "]"
	}
	if port != "" {
		return u.Scheme + "://" + host + ":" + port
	}
	return u.Scheme + "://" + host
}

// IsAllowedReturnURL: allowed client return targets are our web/admin/API origins, the CORS origins, the mobile
// schemes (evtap://, exp://, exps://) and — outside production — localhost.
func IsAllowedReturnURL(cfg *config.Config, raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" {
		return false
	}
	scheme := strings.ToLower(u.Scheme)
	if slices.Contains([]string{"evtap", "exp", "exps"}, scheme) {
		return true
	}
	if scheme != "http" && scheme != "https" || u.Host == "" {
		return false
	}
	candidates := []string{cfg.WebURL, cfg.AdminURL, cfg.APIPublicURL}
	for _, o := range cfg.CORSOrigins {
		if o != "*" {
			candidates = append(candidates, o)
		}
	}
	want := origin(u)
	for _, c := range candidates {
		cu, err := url.Parse(c)
		if err != nil || cu.Scheme == "" || cu.Host == "" {
			continue
		}
		if origin(cu) == want {
			return true
		}
	}
	h := strings.ToLower(u.Hostname())
	return !cfg.IsProd && (h == "localhost" || h == "127.0.0.1")
}

// setParams sets query parameters like URLSearchParams#set: an existing key is replaced in place (later duplicates
// dropped), new keys are appended — the original order is preserved (url.Values.Encode would sort).
func setParams(rawQuery string, kv [][2]string) string {
	var parts []string
	if rawQuery != "" {
		parts = strings.Split(rawQuery, "&")
	}
	for _, p := range kv {
		key, val := p[0], url.QueryEscape(p[0])+"="+url.QueryEscape(p[1])
		found := false
		out := parts[:0:0]
		for _, part := range parts {
			k := part
			if i := strings.IndexByte(part, '='); i >= 0 {
				k = part[:i]
			}
			if dk, err := url.QueryUnescape(k); err == nil && dk == key {
				if !found {
					out = append(out, val)
					found = true
				}
				continue
			}
			out = append(out, part)
		}
		if !found {
			out = append(out, val)
		}
		parts = out
	}
	return strings.Join(parts, "&")
}

// BuildClientReturn appends paymentId & status to the client return URL (works for https:// and evtap:// alike).
func BuildClientReturn(cfg *config.Config, returnURL *string, paymentID, status string) string {
	raw := cfg.WebURL + "/payment/result"
	if returnURL != nil && *returnURL != "" {
		raw = *returnURL
	}
	u, err := url.Parse(raw)
	if err != nil {
		u, _ = url.Parse(cfg.WebURL + "/payment/result")
	}
	u.RawQuery = setParams(u.RawQuery, [][2]string{{"paymentId", paymentID}, {"status", status}})
	return u.String()
}
