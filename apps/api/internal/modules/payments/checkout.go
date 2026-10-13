package payments

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"

	"github.com/google/uuid"

	"github.com/alasgarovnamig/evtap/api/internal/db"
	"github.com/alasgarovnamig/evtap/api/internal/httpx"
	"github.com/alasgarovnamig/evtap/api/internal/modules/wallet"
	"github.com/alasgarovnamig/evtap/api/internal/shared"
)

// CheckoutBody mirrors checkoutSchema (a zod discriminated union on `purpose`); per-purpose rules live in Check.
type CheckoutBody struct {
	Purpose      string   `json:"purpose"`
	Amount       *int     `json:"amount"`
	Method       string   `json:"method"`
	ReturnURL    *string  `json:"returnUrl"`
	ListingID    *string  `json:"listingId"`
	ServiceCodes []string `json:"serviceCodes"`
	BundleCode   *string  `json:"bundleCode"`
	PlanCode     *string  `json:"planCode"`
	Period       *string  `json:"period"`
	AutoRenew    *bool    `json:"autoRenew"`
}

// IsURL mirrors zod's z.string().url() (anything `new URL()` accepts: a scheme is required).
func IsURL(s string) bool {
	u, err := url.Parse(s)
	return err == nil && u.Scheme != "" && (u.Host != "" || u.Opaque != "" || u.Path != "")
}

func (b *CheckoutBody) Check() []string {
	var errs []string
	purposes := []string{"WALLET_TOPUP", "PROMOTION", "LISTING_FEE", "VERIFICATION", "SUBSCRIPTION"}
	if !slices.Contains(purposes, b.Purpose) {
		return []string{"purpose: Invalid discriminator value. Expected " + strings.Join(purposes, " | ")}
	}
	if b.ReturnURL != nil && !IsURL(*b.ReturnURL) {
		errs = append(errs, "returnUrl: Invalid url")
	}
	method := func(allowed ...string) {
		if !slices.Contains(allowed, b.Method) {
			errs = append(errs, "method: Invalid option: expected one of "+strings.Join(allowed, "|"))
		}
	}
	listing := func() {
		if b.ListingID == nil {
			errs = append(errs, "listingId: Required")
		} else if _, err := uuid.Parse(*b.ListingID); err != nil {
			errs = append(errs, "listingId: Invalid uuid")
		}
	}
	switch b.Purpose {
	case "WALLET_TOPUP":
		if b.Amount == nil {
			errs = append(errs, "amount: Required")
		} else if *b.Amount < 100 {
			errs = append(errs, "amount: Too small: expected >= 100")
		}
		method("CARD")
	case "PROMOTION":
		listing()
		if b.ServiceCodes != nil && len(b.ServiceCodes) < 1 {
			errs = append(errs, "serviceCodes: Too small: expected >= 1 items")
		}
		method("CARD", "WALLET")
	case "LISTING_FEE", "VERIFICATION":
		listing()
		method("CARD", "WALLET")
	case "SUBSCRIPTION":
		if b.PlanCode == nil || !slices.Contains([]string{"START", "PRO", "ENTERPRISE"}, *b.PlanCode) {
			errs = append(errs, "planCode: Invalid option: expected one of START|PRO|ENTERPRISE")
		}
		if b.Period == nil || (*b.Period != "MONTH" && *b.Period != "YEAR") {
			errs = append(errs, "period: Invalid option: expected one of MONTH|YEAR")
		}
		method("CARD", "WALLET")
	}
	return errs
}

var periodAz = map[string]string{"MONTH": "aylıq", "YEAR": "illik"}

type ownedListing struct {
	ID, Title, Status string
	IsVerified        bool
}

func (s *Service) ownedListing(ctx context.Context, userID, listingID string, statuses ...string) (*ownedListing, error) {
	var l ownedListing
	var owner string
	err := s.pool.QueryRow(ctx, `select id, title, status, is_verified, owner_id from listings where id = $1`, listingID).Scan(&l.ID, &l.Title, &l.Status, &l.IsVerified, &owner)
	if db.IsNoRows(err) {
		return nil, httpx.NotFound("Listing")
	}
	if err != nil {
		return nil, err
	}
	if owner != userID {
		return nil, httpx.Forbidden("Not your listing")
	}
	if !slices.Contains(statuses, l.Status) {
		return nil, httpx.E(http.StatusConflict, "LISTING_STATUS_INVALID", fmt.Sprintf("Listing must be %s (is %s)", strings.Join(statuses, " or "), l.Status))
	}
	return &l, nil
}

// Checkout (POST /checkout) turns a CheckoutInput into a priced payment (prices always come from the DB catalog).
func (s *Service) Checkout(ctx context.Context, userID string, in *CheckoutBody) (*CheckoutResponse, error) {
	var status, locale string
	var phone, email *string
	err := s.pool.QueryRow(ctx, `select status, locale, phone, email from users where id = $1`, userID).Scan(&status, &locale, &phone, &email)
	if err != nil && !db.IsNoRows(err) {
		return nil, err
	}
	if db.IsNoRows(err) || status != "ACTIVE" {
		return nil, httpx.Forbidden("Account is not active")
	}
	st, err := s.settings.Settings(ctx)
	if err != nil {
		return nil, err
	}
	base := StartInput{UserID: userID, Method: in.Method, Language: locale, Phone: phone, Email: email}
	if in.ReturnURL != nil {
		base.ReturnURL = *in.ReturnURL
	}
	start := func(si StartInput) (*CheckoutResponse, error) {
		r, err := s.StartPayment(ctx, si)
		if err != nil {
			return nil, err
		}
		return &r.Checkout, nil
	}

	switch in.Purpose {
	case "WALLET_TOPUP":
		amount := *in.Amount
		if amount < st.MinTopup || amount > st.MaxTopup {
			return nil, httpx.BadRequest("AMOUNT_OUT_OF_RANGE", fmt.Sprintf("Top-up must be between %s and %s", wallet.FormatMoney(st.MinTopup, "AZN"), wallet.FormatMoney(st.MaxTopup, "AZN")))
		}
		bonus := shared.TopupBonusFor(amount, st)
		si := base
		si.Purpose, si.Amount = "WALLET_TOPUP", amount
		si.Description = "Balansın artırılması — " + wallet.FormatMoney(amount, "AZN")
		si.Items = []Item{{Code: "TOPUP", Name: "Balansın artırılması", Amount: amount}}
		si.Metadata = map[string]any{"bonus": bonus}
		return start(si)

	case "PROMOTION":
		if len(in.ServiceCodes) == 0 && (in.BundleCode == nil || *in.BundleCode == "") {
			return nil, httpx.BadRequest("VALIDATION_ERROR", "serviceCodes or bundleCode is required")
		}
		l, err := s.ownedListing(ctx, userID, *in.ListingID, "ACTIVE", "PENDING")
		if err != nil {
			return nil, err
		}
		catalog, err := s.settings.Catalog(ctx, false)
		if err != nil {
			return nil, err
		}
		var items []Item
		var codes []string
		for _, code := range in.ServiceCodes {
			var svc *shared.ServiceDef
			for i := range catalog.Services {
				if catalog.Services[i].Code == code {
					svc = &catalog.Services[i]
				}
			}
			if svc == nil || svc.PromotionType == nil {
				return nil, httpx.BadRequest("INVALID_SERVICE", "Unknown or unavailable service "+code)
			}
			items = append(items, Item{Code: code, Name: svc.Name.Az, Amount: svc.Price})
			codes = append(codes, code)
		}
		if in.BundleCode != nil && *in.BundleCode != "" {
			var bundle *shared.BundleDef
			for i := range catalog.Bundles {
				if catalog.Bundles[i].Code == *in.BundleCode {
					bundle = &catalog.Bundles[i]
				}
			}
			if bundle == nil {
				return nil, httpx.BadRequest("INVALID_SERVICE", "Unknown bundle "+*in.BundleCode)
			}
			items = append(items, Item{Code: bundle.Code, Name: bundle.Name.Az, Amount: bundle.Price})
			codes = append(codes, bundle.ServiceCodes...)
		}
		if len(codes) > 20 {
			return nil, httpx.BadRequest("VALIDATION_ERROR", "Too many services in one order")
		}
		amount := 0
		names := make([]string, 0, len(items))
		for _, i := range items {
			amount += i.Amount
			names = append(names, i.Name)
		}
		si := base
		si.Purpose, si.Amount, si.ListingID, si.Items = "PROMOTION", amount, &l.ID, items
		si.Metadata = map[string]any{"serviceCodes": codes}
		si.Description = fmt.Sprintf(`%s — "%s"`, strings.Join(names, ", "), l.Title)
		return start(si)

	case "LISTING_FEE":
		l, err := s.ownedListing(ctx, userID, *in.ListingID, "DRAFT")
		if err != nil {
			return nil, err
		}
		si := base
		si.Purpose, si.Amount, si.ListingID = "LISTING_FEE", st.ListingFee, &l.ID
		si.Description = fmt.Sprintf(`Elan yerləşdirmə haqqı — "%s"`, l.Title)
		si.Items = []Item{{Code: "LISTING_FEE", Name: "Elan yerləşdirmə haqqı", Amount: st.ListingFee}}
		return start(si)

	case "VERIFICATION":
		l, err := s.ownedListing(ctx, userID, *in.ListingID, "ACTIVE", "PENDING")
		if err != nil {
			return nil, err
		}
		if l.IsVerified {
			return nil, httpx.E(http.StatusConflict, "ALREADY_VERIFIED", "Listing is already verified")
		}
		svc, err := s.settings.Service(ctx, "VERIFICATION")
		if err != nil {
			return nil, err
		}
		if svc == nil || !svc.Active {
			return nil, httpx.BadRequest("INVALID_SERVICE", "Verification is not available")
		}
		si := base
		si.Purpose, si.Amount, si.ListingID = "VERIFICATION", svc.Price, &l.ID
		si.Description = fmt.Sprintf(`%s — "%s"`, svc.Name.Az, l.Title)
		si.Items = []Item{{Code: svc.Code, Name: svc.Name.Az, Amount: svc.Price}}
		return start(si)

	case "SUBSCRIPTION":
		plan, err := s.settings.Plan(ctx, *in.PlanCode)
		if err != nil {
			return nil, err
		}
		if plan == nil || !plan.Active {
			return nil, httpx.BadRequest("INVALID_PLAN", "Plan is not available")
		}
		period := *in.Period
		amount := shared.PlanPrice(*plan, period)
		name := fmt.Sprintf("%s abunəliyi (%s)", plan.Name.Az, periodAz[period])
		autoRenew := true
		if in.AutoRenew != nil {
			autoRenew = *in.AutoRenew
		}
		si := base
		si.Purpose, si.Amount, si.Description = "SUBSCRIPTION", amount, name
		si.Items = []Item{{Code: plan.Code + "_" + period, Name: name, Amount: amount}}
		si.Metadata = map[string]any{"planCode": plan.Code, "period": period, "autoRenew": autoRenew}
		si.SaveCard = in.Method == "CARD" // the bank token is stored on the subscription for auto-renewal
		return start(si)
	}
	return nil, httpx.BadRequest("VALIDATION_ERROR", "Unknown purpose")
}
