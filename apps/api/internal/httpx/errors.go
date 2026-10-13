// Package httpx contains HTTP plumbing shared by every module: errors, JSON, validation, params, pagination.
package httpx

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/alasgarovnamig/evtap/api/internal/db"
)

// AppError is a domain error rendered as the ApiError shape of @evtap/shared:
// { "statusCode": 400, "code": "OTP_INVALID", "message": "...", "error": "Bad Request" }.
// `code` values must come from ERROR_CODES in packages/shared/src/api.ts.
type AppError struct {
	Status  int
	Code    string
	Message any // string or []string (validation)
}

func (e *AppError) Error() string {
	if s, ok := e.Message.(string); ok {
		return e.Code + ": " + s
	}
	return e.Code
}

func E(status int, code, message string) *AppError {
	return &AppError{Status: status, Code: code, Message: message}
}
func BadRequest(code, message string) *AppError   { return E(http.StatusBadRequest, code, message) }
func NotFound(what string) *AppError              { return E(http.StatusNotFound, "NOT_FOUND", what+" not found") }
func Forbidden(message string) *AppError          { return E(http.StatusForbidden, "FORBIDDEN", message) }
func Conflict(code, message string) *AppError     { return E(http.StatusConflict, code, message) }
func Unauthorized(code, message string) *AppError { return E(http.StatusUnauthorized, code, message) }

// ValidationError lists "field: message" entries (same format as the former zod pipe).
func ValidationError(messages []string) *AppError {
	return &AppError{Status: http.StatusBadRequest, Code: "VALIDATION_ERROR", Message: messages}
}

// WriteError renders any error. Unknown errors become 500 INTERNAL (logged); unique violations become 409 CONFLICT.
func WriteError(w http.ResponseWriter, r *http.Request, err error) {
	var ae *AppError
	switch {
	case errors.As(err, &ae):
	case db.IsUniqueViolation(err):
		ae = E(http.StatusConflict, "CONFLICT", "Already exists")
	case db.IsNoRows(err):
		ae = E(http.StatusNotFound, "NOT_FOUND", "Resource not found")
	default:
		slog.Error("unhandled error", "method", r.Method, "path", r.URL.Path, "err", err)
		ae = E(http.StatusInternalServerError, "INTERNAL", "Internal server error")
	}
	JSON(w, ae.Status, map[string]any{"statusCode": ae.Status, "code": ae.Code, "message": ae.Message, "error": http.StatusText(ae.Status)})
}
