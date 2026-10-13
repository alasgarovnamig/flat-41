package app

import (
	"bytes"
	"embed"
	"encoding/json"
	"html/template"
	"strings"
	"time"

	"github.com/alasgarovnamig/evtap/mockbank/internal/i18n"
)

//go:embed templates/*.html static/*
var assets embed.FS

type views struct {
	cardForm, threeDS, result, notFound           *template.Template
	adminOrders, adminOrder, adminTokens, adminMs *template.Template
	checkoutCSS, acsCSS, resultCSS, adminCSS      template.CSS
	checkoutJS                                    template.JS
}

func mustAsset(name string) string {
	b, err := assets.ReadFile(name)
	if err != nil {
		panic(err)
	}
	return string(b)
}

var templateFuncs = template.FuncMap{
	"statusLabel": func(s string) string { return strings.Replace(s, "_", " ", 1) },
}

func mustTemplate(layout, page string) *template.Template {
	return template.Must(template.New(page).Funcs(templateFuncs).ParseFS(assets, "templates/"+layout, "templates/"+page))
}

func mustLoadViews() *views {
	return &views{
		cardForm:    mustTemplate("checkout_layout.html", "card_form.html"),
		threeDS:     mustTemplate("checkout_layout.html", "threeds.html"),
		result:      mustTemplate("checkout_layout.html", "result.html"),
		notFound:    mustTemplate("checkout_layout.html", "not_found.html"),
		adminOrders: mustTemplate("admin_layout.html", "admin_orders.html"),
		adminOrder:  mustTemplate("admin_layout.html", "admin_order.html"),
		adminTokens: mustTemplate("admin_layout.html", "admin_tokens.html"),
		adminMs:     mustTemplate("admin_layout.html", "admin_merchants.html"),
		checkoutCSS: template.CSS(mustAsset("static/checkout.css")),
		acsCSS:      template.CSS(mustAsset("static/acs.css")),
		resultCSS:   template.CSS(mustAsset("static/result.css")),
		adminCSS:    template.CSS(mustAsset("static/admin.css")),
		checkoutJS:  template.JS(mustAsset("static/checkout.js")),
	}
}

// entitySpelling maps html/template's numeric entities to the spelling the former Node views
// used (&quot;, literal "+"), so pages stay byte-identical. Both are equivalent HTML; a literal
// "&#34;" in user data is escaped to "&amp;#34;" first, so it is never touched.
var entitySpelling = strings.NewReplacer("&#34;", "&quot;", "&#43;", "+")

func render(t *template.Template, data any) ([]byte, error) {
	var buf bytes.Buffer
	if err := t.ExecuteTemplate(&buf, "layout", data); err != nil {
		return nil, err
	}
	return []byte(entitySpelling.Replace(buf.String())), nil
}

// ---------------------------------------------------------------- dates

var bakuTZ = func() *time.Location {
	if loc, err := time.LoadLocation("Asia/Baku"); err == nil {
		return loc
	}
	return time.FixedZone("+04", 4*3600)
}()

// formatDateTime mirrors toLocaleString('en-GB', { timeZone: 'Asia/Baku', … }): "13/10/2026, 16:34:56".
func formatDateTime(t time.Time) string { return t.In(bakuTZ).Format("02/01/2006, 15:04:05") }

func formatDateTimePtr(t *time.Time) string {
	if t == nil {
		return "—"
	}
	return formatDateTime(*t)
}

// ---------------------------------------------------------------- checkout page context

// pageCtx is shared by every checkout page.
type pageCtx struct {
	Lang         string
	LangOverride string // explicit ?lang= chosen by the customer (kept across form posts)
	IsProd       bool
	Path         string // current path without query, for the language switcher
	tr           i18n.Translator
}

// T translates key with {name} placeholders: {{.T "pay" "amount" .Amount}}.
func (p pageCtx) T(key string, pairs ...any) string { return p.tr.T(key, pairs...) }

// WithLang appends ?lang= when the customer picked a language explicitly.
func (p pageCtx) WithLang(path string) string {
	if p.LangOverride != "" {
		return path + "?lang=" + p.LangOverride
	}
	return path
}

type langLink struct{ Href, Class, Lang, Name string }

// LangLinks is the az / ru / en switcher.
func (p pageCtx) LangLinks() []langLink {
	out := make([]langLink, 0, len(i18n.Languages))
	for _, l := range i18n.Languages {
		cls := ""
		if l == p.Lang {
			cls = "on"
		}
		out = append(out, langLink{Href: p.Path + "?lang=" + l, Class: cls, Lang: l, Name: i18n.LanguageNames[l]})
	}
	return out
}

// checkoutLayout carries the layout fields of a checkout page.
type checkoutLayout struct {
	pageCtx
	Title      string
	BaseCSS    template.CSS
	ExtraCSS   template.CSS
	RefreshURL string
	ShowTopbar bool
}

func (v *views) layout(ctx pageCtx, title string, extraCSS template.CSS, topbar bool) checkoutLayout {
	return checkoutLayout{pageCtx: ctx, Title: title, BaseCSS: v.checkoutCSS, ExtraCSS: extraCSS, ShowTopbar: topbar}
}

// jsonScript is JSON safe to embed inside an inline <script>.
func jsonScript(v any) template.JS {
	b, _ := json.Marshal(v) // escapes <, > and & as <, >, &
	return template.JS(b)
}
