package uploads

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/alasgarovnamig/evtap/api/internal/config"
)

// Storage is the object storage abstraction. Drivers:
//   - local (default): files under UPLOAD_DIR, served by the API at ${API_PUBLIC_URL}/uploads/<key>.
//   - s3: S3-compatible bucket (AWS, MinIO, Cloudflare R2), public URL ${S3_PUBLIC_URL}/<key> — stub, see S3Storage.
type Storage interface {
	Put(ctx context.Context, key string, body []byte, contentType string) error
	Delete(ctx context.Context, key string) error
	PublicURL(key string) string
}

// NewStorage returns the driver selected by STORAGE_DRIVER.
func NewStorage(cfg *config.Config) Storage {
	if cfg.Storage.Driver == "s3" {
		return &S3Storage{cfg: cfg}
	}
	return &LocalStorage{Root: cfg.Storage.UploadDir, BaseURL: strings.TrimRight(cfg.APIPublicURL, "/") + "/uploads"}
}

// LocalStorage writes files below Root.
type LocalStorage struct {
	Root    string
	BaseURL string
}

func (s *LocalStorage) path(key string) (string, error) {
	clean := filepath.Clean("/" + key)
	if strings.Contains(clean, "..") {
		return "", errors.New("invalid storage key")
	}
	return filepath.Join(s.Root, filepath.FromSlash(clean)), nil
}

func (s *LocalStorage) Put(_ context.Context, key string, body []byte, _ string) error {
	p, err := s.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return err
	}
	return os.WriteFile(p, body, 0o644)
}

func (s *LocalStorage) Delete(_ context.Context, key string) error {
	p, err := s.path(key)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *LocalStorage) PublicURL(key string) string { return s.BaseURL + "/" + key }

// ErrS3NotImplemented is returned by the S3 stub.
var ErrS3NotImplemented = errors.New("STORAGE_DRIVER=s3 is not implemented in the Go API yet (use local, or plug an S3 client into S3Storage)")

// S3Storage is a stub: URLs are computed from S3_PUBLIC_URL, writes fail until an S3 client
// (e.g. github.com/aws/aws-sdk-go-v2/service/s3 or minio-go) is wired in.
type S3Storage struct{ cfg *config.Config }

func (s *S3Storage) Put(context.Context, string, []byte, string) error { return ErrS3NotImplemented }
func (s *S3Storage) Delete(context.Context, string) error              { return ErrS3NotImplemented }
func (s *S3Storage) PublicURL(key string) string {
	return strings.TrimRight(s.cfg.Storage.S3.PublicURL, "/") + "/" + key
}
