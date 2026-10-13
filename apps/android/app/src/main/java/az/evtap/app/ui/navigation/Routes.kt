package az.evtap.app.ui.navigation

import kotlinx.serialization.Serializable

/** Type-safe Navigation Compose destinations (navigation 2.8+ @Serializable routes). */
@Serializable data object MainRoute
@Serializable data class ListingRoute(val id: String)
@Serializable data class GalleryRoute(val id: String, val index: Int = 0)
@Serializable data class ReviewsRoute(val listingId: String)
@Serializable data class BookRoute(val listingId: String)
@Serializable data class BookingRoute(val id: String)
@Serializable data object AuthPhoneRoute
@Serializable data class AuthCodeRoute(val phone: String, val retryAfter: Int, val devCode: String? = null)
@Serializable data class AuthEmailRoute(val register: Boolean = false)
@Serializable data class PostRoute(val editId: String? = null)
@Serializable data class ListingFeeRoute(val id: String)
@Serializable data class PromoteRoute(val id: String, val upsell: Boolean = false)
@Serializable data class PaymentResultRoute(val paymentId: String, val status: String? = null)
@Serializable data object WalletRoute
@Serializable data object PaymentsRoute
@Serializable data object MyListingsRoute
@Serializable data class ListingStatsRoute(val id: String)
@Serializable data object BookingsRoute
@Serializable data class HostCalendarRoute(val listingId: String? = null)
@Serializable data class ChatRoute(val conversationId: String)
@Serializable data class NewChatRoute(val listingId: String, val title: String, val name: String)
@Serializable data object NotificationsRoute
@Serializable data object SavedSearchesRoute
@Serializable data object FavoritesRoute
@Serializable data object BusinessRoute
@Serializable data object AgencyRoute
@Serializable data object SettingsRoute
@Serializable data object EditProfileRoute
@Serializable data object PagesRoute
@Serializable data class PageRoute(val slug: String)

/** Bottom bar tabs of [MainRoute]. */
enum class MainTab { HOME, SEARCH, MESSAGES, PROFILE }
