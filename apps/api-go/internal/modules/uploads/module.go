// Package uploads: POST /uploads — image upload, EXIF auto-orientation, resize to max 1600 px + 400 px thumbnail.
//
// Output is WebP like the former NestJS API (sharp: q80 full, q70 thumb) — the contract pins `mime: image/webp`.
// Encoding uses github.com/gen2brain/webp without cgo: the system libwebp (libwebp.so, loaded via purego) when
// installed, else the bundled WebAssembly build (~1 s per 1600 px image). UPLOAD_IMAGE_FORMAT=jpeg switches to
// JPEG q82 (stdlib encoder, faster). Keys: listings/YYYY/MM/<id>.webp and <id>_thumb.webp (.jpg for JPEG).
package uploads

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/png" // decoder registration
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/disintegration/imaging"
	"github.com/gen2brain/webp"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/httprate"
	"github.com/google/uuid"
	_ "golang.org/x/image/webp" // decoder registration

	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/auth"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
)

const (
	MaxUploadBytes = 10 * 1024 * 1024
	FullPx         = 1600
	ThumbPx        = 400
	JPEGQuality    = 82
	WebPQuality    = 80
	WebPThumbQ     = 70
)

// Format is an output encoding for normalised uploads.
type Format struct {
	Ext, Mime string
	Encode    func(w io.Writer, img image.Image, thumb bool) error
}

// WebP (default) mirrors the former sharp pipeline.
var WebP = Format{Ext: ".webp", Mime: "image/webp", Encode: func(w io.Writer, img image.Image, thumb bool) error {
	q := WebPQuality
	if thumb {
		q = WebPThumbQ
	}
	return webp.Encode(w, img, webp.Options{Quality: q, Method: 4})
}}

// JPEG is the faster alternative (UPLOAD_IMAGE_FORMAT=jpeg); transparency is flattened onto white.
var JPEG = Format{Ext: ".jpg", Mime: "image/jpeg", Encode: func(w io.Writer, img image.Image, _ bool) error {
	return jpeg.Encode(w, flatten(img), &jpeg.Options{Quality: JPEGQuality})
}}

// FormatFromEnv returns JPEG when UPLOAD_IMAGE_FORMAT=jpeg, else WebP.
func FormatFromEnv() Format {
	if strings.EqualFold(os.Getenv("UPLOAD_IMAGE_FORMAT"), "jpeg") {
		return JPEG
	}
	return WebP
}

// AllowedMIME are the declared content types accepted (HEIC/AVIF pass the filter like before, but cannot be
// decoded in pure Go and answer INVALID_IMAGE).
var AllowedMIME = []string{"image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif", "image/avif"}

// Upload DTO.
type Upload struct {
	ID       string `json:"id"`
	URL      string `json:"url"`
	ThumbURL string `json:"thumbUrl"`
	Mime     string `json:"mime"`
	Size     int    `json:"size"`
}

type Module struct {
	d       *app.Deps
	Storage Storage
	Format  Format
}

func New(d *app.Deps) *Module {
	return &Module{d: d, Storage: NewStorage(d.Cfg), Format: FormatFromEnv()}
}

func (m *Module) Routes(r chi.Router) {
	limit := httprate.Limit(60, time.Minute, httprate.WithKeyFuncs(httprate.KeyByIP),
		httprate.WithLimitHandler(func(w http.ResponseWriter, r *http.Request) {
			httpx.WriteError(w, r, httpx.E(http.StatusTooManyRequests, "RATE_LIMITED", "Too many requests"))
		}))
	r.With(auth.Required, limit).Post("/uploads", httpx.HS(http.StatusCreated, func(w http.ResponseWriter, r *http.Request) (any, error) {
		data, mime, err := readFile(r)
		if err != nil {
			return nil, err
		}
		return m.UploadImage(r.Context(), auth.Current(r).ID, data, mime)
	}))
}

func fileRequired() error {
	return httpx.BadRequest("FILE_REQUIRED", `Multipart field "file" is required`)
}
func tooLarge() error {
	return httpx.E(http.StatusRequestEntityTooLarge, "FILE_TOO_LARGE", "Max file size is 10MB")
}
func unsupported() error {
	return httpx.E(http.StatusUnsupportedMediaType, "UNSUPPORTED_FILE_TYPE", "Only JPEG, PNG, WEBP or HEIC images are allowed")
}
func invalidImage() error {
	return httpx.E(http.StatusUnsupportedMediaType, "INVALID_IMAGE", "File is not a valid or supported image")
}

// readFile streams the multipart body and returns the "file" part (≤ MaxUploadBytes) and its declared type.
func readFile(r *http.Request) ([]byte, string, error) {
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "multipart/form-data") {
		return nil, "", fileRequired()
	}
	mr, err := r.MultipartReader()
	if err != nil {
		return nil, "", fileRequired()
	}
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			return nil, "", fileRequired()
		}
		if err != nil {
			return nil, "", fileRequired()
		}
		if part.FormName() != "file" || part.FileName() == "" {
			_ = part.Close()
			continue
		}
		return readPart(part)
	}
}

func readPart(part *multipart.Part) ([]byte, string, error) {
	defer part.Close()
	mime := strings.ToLower(strings.TrimSpace(strings.SplitN(part.Header.Get("Content-Type"), ";", 2)[0]))
	if !contains(AllowedMIME, mime) {
		return nil, "", unsupported()
	}
	data, err := io.ReadAll(io.LimitReader(part, MaxUploadBytes+1))
	if err != nil {
		return nil, "", fileRequired()
	}
	if len(data) > MaxUploadBytes {
		return nil, "", tooLarge()
	}
	if len(data) == 0 {
		return nil, "", fileRequired()
	}
	return data, mime, nil
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// Process decodes (EXIF auto-orient), resizes (never enlarges) and encodes an image: full ≤ 1600 px, thumb ≤ 400 px.
func Process(data []byte, f Format) (full, thumb []byte, w, h int, err error) {
	img, err := imaging.Decode(bytes.NewReader(data), imaging.AutoOrientation(true))
	if err != nil {
		return nil, nil, 0, 0, err
	}
	fi := imaging.Fit(img, FullPx, FullPx, imaging.Lanczos)
	ti := imaging.Fit(img, ThumbPx, ThumbPx, imaging.Lanczos)
	var fb, tb bytes.Buffer
	if err := f.Encode(&fb, fi, false); err != nil {
		return nil, nil, 0, 0, err
	}
	if err := f.Encode(&tb, ti, true); err != nil {
		return nil, nil, 0, 0, err
	}
	return fb.Bytes(), tb.Bytes(), fi.Bounds().Dx(), fi.Bounds().Dy(), nil
}

// flatten composes images with transparency onto white (JPEG has no alpha channel).
func flatten(img image.Image) image.Image {
	if op, ok := img.(interface{ Opaque() bool }); ok && op.Opaque() {
		return img
	}
	b := img.Bounds()
	dst := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(dst, dst.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.Draw(dst, dst.Bounds(), img, b.Min, draw.Over)
	return dst
}

// UploadImage normalises and stores an image and records it in the uploads table.
func (m *Module) UploadImage(ctx context.Context, userID string, data []byte, _ string) (*Upload, error) {
	if len(data) == 0 {
		return nil, fileRequired()
	}
	if len(data) > MaxUploadBytes {
		return nil, tooLarge()
	}
	full, thumb, w, h, err := Process(data, m.Format)
	if err != nil {
		return nil, invalidImage()
	}
	now := time.Now().UTC()
	id := uuid.NewString()
	dir := "listings/" + now.Format("2006/01")
	key, thumbKey := dir+"/"+id+m.Format.Ext, dir+"/"+id+"_thumb"+m.Format.Ext
	if err := m.Storage.Put(ctx, key, full, m.Format.Mime); err != nil {
		return nil, err
	}
	if err := m.Storage.Put(ctx, thumbKey, thumb, m.Format.Mime); err != nil {
		return nil, err
	}
	u := &Upload{ID: id, URL: m.Storage.PublicURL(key), ThumbURL: m.Storage.PublicURL(thumbKey), Mime: m.Format.Mime, Size: len(full)}
	if _, err := m.d.Pool.Exec(ctx, `insert into uploads (id, user_id, key, thumb_key, url, thumb_url, mime, size, width, height)
		values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, id, userID, key, thumbKey, u.URL, u.ThumbURL, u.Mime, u.Size, w, h); err != nil {
		return nil, err
	}
	return u, nil
}
