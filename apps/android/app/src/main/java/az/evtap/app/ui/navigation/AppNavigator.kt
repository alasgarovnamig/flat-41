package az.evtap.app.ui.navigation

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.navigation.NavHostController
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavOptionsBuilder
import androidx.navigation.toRoute
import az.evtap.app.AppContainer
import az.evtap.app.platform.Intents
import az.evtap.core.deeplink.DeepLink
import az.evtap.core.deeplink.DeepLinkParser
import az.evtap.core.model.CheckoutResponse
import az.evtap.core.model.PaymentStatus
import az.evtap.core.search.ListingFilters

val LocalNavigator = staticCompositionLocalOf<AppNavigator> { error("AppNavigator not provided") }

/**
 * Navigation facade used by screens: typed routes, the Main tabs, the auth gate and the card-payment hand-off.
 * View models never navigate; screens call this from UI events.
 */
class AppNavigator(val nav: NavHostController, private val container: AppContainer) {
    var tab by mutableStateOf(MainTab.HOME)
    /** Login prompt sheet (shown by the root when an action needs an account). */
    var authPrompt by mutableStateOf(false)

    val returnUrl: String get() = DeepLinkParser.PAYMENT_RETURN_URL

    fun back() {
        if (!nav.popBackStack()) tab = MainTab.HOME
    }

    fun open(route: Any, builder: NavOptionsBuilder.() -> Unit = {}) {
        nav.navigate(route) {
            launchSingleTop = true
            builder()
        }
    }

    /** Replaces the current screen (wizard → payment, auth → back to where the user was). */
    fun replace(route: Any) {
        val current = nav.currentBackStackEntry?.destination?.id
        nav.navigate(route) {
            launchSingleTop = true
            if (current != null) popUpTo(current) { inclusive = true }
        }
    }

    fun toMain(tab: MainTab) {
        this.tab = tab
        nav.popBackStack(MainRoute, inclusive = false)
    }

    fun search(filters: ListingFilters) {
        container.requestSearch(filters)
        toMain(MainTab.SEARCH)
    }

    fun openListing(id: String) = open(ListingRoute(id))

    /** Runs [action] when logged in, otherwise shows the login prompt. */
    fun requireAuth(action: () -> Unit) {
        if (container.session.isAuthed) action() else authPrompt = true
    }

    fun login() {
        authPrompt = false
        open(AuthPhoneRoute)
    }

    /** After a successful login: leave the auth screens and return to the screen that asked for it. */
    fun finishAuth() {
        // AuthCode / AuthEmail are always opened on top of AuthPhone, so popping it clears the whole auth flow.
        if (!nav.popBackStack(AuthPhoneRoute, inclusive = true)) nav.popBackStack()
    }

    /**
     * Completes POST /checkout | /bookings | /bookings/:id/pay:
     *  - WALLET (or already final) → result screen directly;
     *  - CARD → result screen first (it polls GET /payments/:id), then the bank page in a Custom Tab on top. The bank
     *    redirects to evtap://payment/result, which brings MainActivity (singleTask) back and closes the tab; if the
     *    user just closes the tab, the result screen is already there polling.
     */
    fun completeCheckout(res: CheckoutResponse, context: Context, toolbarColor: Int, dark: Boolean) {
        open(PaymentResultRoute(res.paymentId, res.status.name))
        val url = res.paymentUrl
        if (url != null && !res.status.isFinal && res.status != PaymentStatus.SUCCEEDED) {
            Intents.customTab(context, url, toolbarColor, dark)
        }
    }

    fun handle(link: DeepLink, context: Context) {
        when (link) {
            DeepLink.Home -> toMain(MainTab.HOME)
            is DeepLink.Listing -> openListing(link.id)
            is DeepLink.Search -> search(ListingFilters.fromQuery(link.query))
            is DeepLink.PaymentResult -> {
                val top = nav.currentBackStackEntry
                val already = top != null && top.destination.hasRoute<PaymentResultRoute>() &&
                    top.toRoute<PaymentResultRoute>().paymentId == link.paymentId
                if (!already) open(PaymentResultRoute(link.paymentId, link.status?.name))
            }
            is DeepLink.Booking -> requireAuth { open(BookingRoute(link.id)) }
            is DeepLink.Conversation -> requireAuth { open(ChatRoute(link.id)) }
            is DeepLink.Page -> open(PageRoute(link.slug))
            is DeepLink.Agency -> Intents.openBrowser(context, "${container.webUrl}/${az.evtap.app.platform.AppLanguage.current().tag}/agencies/${link.slug}")
            DeepLink.Notifications -> requireAuth { open(NotificationsRoute) }
            DeepLink.Wallet -> requireAuth { open(WalletRoute) }
            DeepLink.MyListings -> requireAuth { open(MyListingsRoute) }
            DeepLink.Bookings -> requireAuth { open(BookingsRoute) }
            DeepLink.Business -> requireAuth { open(BusinessRoute) }
            DeepLink.SavedSearches -> requireAuth { open(SavedSearchesRoute) }
        }
    }
}
