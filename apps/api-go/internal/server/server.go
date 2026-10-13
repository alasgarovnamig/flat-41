// Package server builds the HTTP router: global middleware, /api/v1 module routes, /ws, /uploads.
package server

import (
	"log/slog"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go-chi/httprate"

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
)

const APIPrefix = "/api/v1"

// RootRouter is implemented by modules that also serve routes outside /api/v1 (e.g. realtime at /ws).
type RootRouter interface{ RootRoutes(r chi.Router) }

func New(d *app.Deps, modules []app.Module) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RealIP) // trust X-Forwarded-For / X-Real-IP from the reverse proxy
	r.Use(middleware.RequestID)
	r.Use(requestLogger)
	r.Use(middleware.Recoverer)
	r.Use(corsHandler(d.Cfg.CORSOrigins))
	r.Use(globalRateLimit())
	r.Use(d.Signer.Authenticate)

	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteError(w, r, httpx.E(http.StatusNotFound, "NOT_FOUND", "Cannot "+r.Method+" "+r.URL.Path))
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteError(w, r, httpx.E(http.StatusNotFound, "NOT_FOUND", "Cannot "+r.Method+" "+r.URL.Path))
	})

	r.Route(APIPrefix, func(api chi.Router) {
		api.Get("/health", httpx.H(func(w http.ResponseWriter, r *http.Request) (any, error) {
			if err := d.Pool.Ping(r.Context()); err != nil {
				return nil, err
			}
			return map[string]string{"status": "ok", "time": httpx.ISO(time.Now())}, nil
		}))
		d.Auth.Routes(api)
		for _, m := range modules {
			m.Routes(api)
		}
	})
	for _, m := range modules {
		if rr, ok := m.(RootRouter); ok {
			rr.RootRoutes(r)
		}
	}
	if d.Cfg.Storage.Driver == "local" {
		fs := http.StripPrefix("/uploads/", http.FileServer(http.Dir(filepath.Clean(d.Cfg.Storage.UploadDir))))
		r.Get("/uploads/*", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "public, max-age=2592000")
			fs.ServeHTTP(w, r)
		})
	}
	return r
}

// globalRateLimit allows 300 req/min per IP; bank webhooks (server-to-server, signed) are exempt.
func globalRateLimit() func(http.Handler) http.Handler {
	limiter := httprate.Limit(300, time.Minute, httprate.WithKeyFuncs(httprate.KeyByIP),
		httprate.WithLimitHandler(func(w http.ResponseWriter, r *http.Request) {
			httpx.WriteError(w, r, httpx.E(http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests"))
		}))
	return func(next http.Handler) http.Handler {
		limited := limiter(next)
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, APIPrefix+"/payments/webhook/") {
				next.ServeHTTP(w, r)
				return
			}
			limited.ServeHTTP(w, r)
		})
	}
}

func corsHandler(origins []string) func(http.Handler) http.Handler {
	opts := cors.Options{
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Authorization", "Content-Type", "X-Requested-With", "Accept", "Accept-Language"},
		AllowCredentials: true,
		MaxAge:           600,
	}
	all := false
	for _, o := range origins {
		if o == "*" {
			all = true
		}
	}
	if all {
		opts.AllowOriginFunc = func(r *http.Request, origin string) bool { return true }
	} else {
		opts.AllowedOrigins = origins
	}
	return cors.Handler(opts)
}

func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		start := time.Now()
		next.ServeHTTP(ww, r)
		if r.URL.Path == APIPrefix+"/health" {
			return
		}
		lvl := slog.LevelInfo
		if ww.Status() >= 500 {
			lvl = slog.LevelError
		}
		slog.Log(r.Context(), lvl, "http", "method", r.Method, "path", r.URL.Path, "status", ww.Status(), "ms", time.Since(start).Milliseconds())
	})
}
