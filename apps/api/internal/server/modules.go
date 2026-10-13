package server

import (
	"github.com/alasgarovnamig/evtap/api/internal/app"
	"github.com/alasgarovnamig/evtap/api/internal/modules/admin"
	"github.com/alasgarovnamig/evtap/api/internal/modules/agencies"
	"github.com/alasgarovnamig/evtap/api/internal/modules/bookings"
	"github.com/alasgarovnamig/evtap/api/internal/modules/catalog"
	"github.com/alasgarovnamig/evtap/api/internal/modules/content"
	"github.com/alasgarovnamig/evtap/api/internal/modules/favorites"
	"github.com/alasgarovnamig/evtap/api/internal/modules/listings"
	"github.com/alasgarovnamig/evtap/api/internal/modules/locations"
	"github.com/alasgarovnamig/evtap/api/internal/modules/messaging"
	"github.com/alasgarovnamig/evtap/api/internal/modules/mortgage"
	"github.com/alasgarovnamig/evtap/api/internal/modules/notifications"
	"github.com/alasgarovnamig/evtap/api/internal/modules/payments"
	"github.com/alasgarovnamig/evtap/api/internal/modules/promotions"
	"github.com/alasgarovnamig/evtap/api/internal/modules/push"
	"github.com/alasgarovnamig/evtap/api/internal/modules/realtime"
	"github.com/alasgarovnamig/evtap/api/internal/modules/savedsearches"
	"github.com/alasgarovnamig/evtap/api/internal/modules/stats"
	"github.com/alasgarovnamig/evtap/api/internal/modules/subscriptions"
	"github.com/alasgarovnamig/evtap/api/internal/modules/uploads"
	"github.com/alasgarovnamig/evtap/api/internal/modules/users"
	"github.com/alasgarovnamig/evtap/api/internal/modules/wallet"
)

// Modules constructs every feature module. Order matters only for cross-module service registration:
// providers (wallet, promotions, listings) are created before their consumers.
func Modules(d *app.Deps) []app.Module {
	return []app.Module{
		// money providers first
		wallet.New(d),
		promotions.New(d),
		// marketplace
		users.New(d),
		locations.New(d),
		uploads.New(d),
		listings.New(d),
		favorites.New(d),
		savedsearches.New(d),
		agencies.New(d),
		mortgage.New(d),
		content.New(d),
		stats.New(d),
		admin.New(d),
		// money
		catalog.New(d),
		payments.New(d),
		subscriptions.New(d),
		bookings.New(d),
		// communication
		messaging.New(d),
		notifications.New(d),
		push.New(d),
		realtime.New(d),
	}
}
