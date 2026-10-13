package httpx

import (
	"net/http"
	"reflect"
	"strings"

	"github.com/go-playground/validator/v10"

	"github.com/alasgarovnamig/evtap/api/internal/shared"
)

var validate = func() *validator.Validate {
	v := validator.New(validator.WithRequiredStructEnabled())
	// Report JSON field names ("cityId", not "CityID").
	v.RegisterTagNameFunc(func(f reflect.StructField) string {
		name := strings.SplitN(f.Tag.Get("json"), ",", 2)[0]
		if name == "-" {
			return ""
		}
		return name
	})
	// phone: E.164 Azerbaijani/Georgian mobile (call shared.NormalizePhone before validating).
	_ = v.RegisterValidation("phone", func(fl validator.FieldLevel) bool { return shared.PhoneRe.MatchString(fl.Field().String()) })
	_ = v.RegisterValidation("isodate", func(fl validator.FieldLevel) bool { return shared.ISODateRe.MatchString(fl.Field().String()) })
	_ = v.RegisterValidation("hhmm", func(fl validator.FieldLevel) bool { return shared.HHMMRe.MatchString(fl.Field().String()) })
	return v
}()

// Normalizer can be implemented by request structs to trim / normalise fields before validation
// (e.g. phone "050 123 45 67" → "+994501234567", lower-case emails).
type Normalizer interface{ Normalize() }

// Checker can be implemented for cross-field rules (zod superRefine equivalents). Return "field: message" strings.
type Checker interface{ Check() []string }

// Validate runs Normalize, struct-tag validation and Check, returning a VALIDATION_ERROR listing all problems.
func Validate(dst any) error {
	if n, ok := dst.(Normalizer); ok {
		n.Normalize()
	}
	var msgs []string
	if err := validate.Struct(dst); err != nil {
		if ve, ok := err.(validator.ValidationErrors); ok {
			for _, fe := range ve {
				path := fe.Namespace()
				if i := strings.Index(path, "."); i >= 0 {
					path = path[i+1:]
				}
				msgs = append(msgs, path+": "+describe(fe))
			}
		} else {
			msgs = append(msgs, err.Error())
		}
	}
	if c, ok := dst.(Checker); ok {
		msgs = append(msgs, c.Check()...)
	}
	if len(msgs) > 0 {
		return ValidationError(msgs)
	}
	return nil
}

// Bind decodes the JSON body into dst and validates it.
func Bind(r *http.Request, dst any) error {
	if err := DecodeJSON(r, dst); err != nil {
		return err
	}
	return Validate(dst)
}

func describe(fe validator.FieldError) string {
	switch fe.Tag() {
	case "required":
		return "Required"
	case "min", "gte":
		return "Too small: expected >= " + fe.Param()
	case "max", "lte":
		return "Too big: expected <= " + fe.Param()
	case "gt":
		return "Too small: expected > " + fe.Param()
	case "oneof":
		return "Invalid option: expected one of " + strings.ReplaceAll(fe.Param(), " ", "|")
	case "email":
		return "Invalid email address"
	case "url", "http_url":
		return "Invalid URL"
	case "uuid", "uuid4":
		return "Invalid UUID"
	case "phone":
		return "Invalid phone number"
	case "isodate":
		return "Expected YYYY-MM-DD"
	case "hhmm":
		return "Expected HH:MM"
	case "len":
		return "Expected length " + fe.Param()
	}
	return "Invalid value (" + fe.Tag() + ")"
}
