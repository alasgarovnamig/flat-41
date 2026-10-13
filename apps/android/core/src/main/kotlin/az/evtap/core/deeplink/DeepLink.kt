package az.evtap.core.deeplink

import az.evtap.core.model.PaymentStatus
import az.evtap.core.search.enumOrNull
import java.net.URI
import java.net.URLDecoder

/** Where an incoming link (evtap://…, https://evtap.az/…, push payload) should take the user. */
sealed interface DeepLink {
    data object Home : DeepLink
    data class Listing(val id: String) : DeepLink
    data class Search(val query: Map<String, String>) : DeepLink
    data class PaymentResult(val paymentId: String, val status: PaymentStatus?) : DeepLink
    data class Booking(val id: String) : DeepLink
    data class Conversation(val id: String) : DeepLink
    data class Page(val slug: String) : DeepLink
    data class Agency(val slug: String) : DeepLink
    data object Notifications : DeepLink
    data object Wallet : DeepLink
    data object MyListings : DeepLink
    data object Bookings : DeepLink
    data object Business : DeepLink
    data object SavedSearches : DeepLink
}

/**
 * Parses app links. Supported forms (scheme `evtap://` or `https://evtap.az` / `www.evtap.az`):
 * `listing/<id>`, `search?…`, `payment/result?paymentId=…&status=…`, `booking/<id>`, `chat/<id>`, `page/<slug>`
 * (+ web paths `/about` etc. → page), `agency/<slug>`, `me/wallet`, `me/listings`, `me/bookings`, `me/business`,
 * `me/saved-searches`, `me/notifications`.
 */
object DeepLinkParser {
    const val SCHEME = "evtap"
    const val PAYMENT_RETURN_URL = "evtap://payment/result"
    private val WEB_HOSTS = setOf("evtap.az", "www.evtap.az")
    private val CMS_SLUGS = setOf("about", "terms", "privacy", "help", "contacts", "faq")

    fun parse(url: String?): DeepLink? {
        if (url.isNullOrBlank()) return null
        val uri = runCatching { URI(url.trim()) }.getOrNull() ?: return null
        val segments: List<String> = when {
            uri.scheme.equals(SCHEME, ignoreCase = true) ->
                // evtap://listing/123 → host = "listing", path = "/123"
                listOfNotNull(uri.host) + pathSegments(uri.rawPath)
            (uri.scheme.equals("https", true) || uri.scheme.equals("http", true)) && uri.host?.lowercase() in WEB_HOSTS ->
                pathSegments(uri.rawPath).let { if (it.firstOrNull() in setOf("az", "ru", "en")) it.drop(1) else it }
            else -> return null
        }
        val query = parseQuery(uri.rawQuery)
        return fromSegments(segments, query)
    }

    /** Push notification `data` (`{ type, url?, conversationId?, paymentId?, bookingId?, listingId? }`) → link. */
    fun fromPushData(data: Map<String, String?>): DeepLink? {
        data["url"]?.let { u -> parse(u)?.let { return it } }
        data["conversationId"]?.takeIf { it.isNotBlank() }?.let { return DeepLink.Conversation(it) }
        data["paymentId"]?.takeIf { it.isNotBlank() }?.let { return DeepLink.PaymentResult(it, null) }
        data["bookingId"]?.takeIf { it.isNotBlank() }?.let { return DeepLink.Booking(it) }
        data["listingId"]?.takeIf { it.isNotBlank() }?.let { return DeepLink.Listing(it) }
        if (data["type"] == "SAVED_SEARCH_MATCH") return DeepLink.SavedSearches
        return if (data.containsKey("notificationId")) DeepLink.Notifications else null
    }

    private fun fromSegments(s: List<String>, q: Map<String, String>): DeepLink? = when (s.firstOrNull()) {
        null, "", "home" -> DeepLink.Home
        "listing", "listings", "elan" -> s.getOrNull(1)?.let { DeepLink.Listing(it) }
        "search", "axtaris" -> DeepLink.Search(q)
        "payment" -> if (s.getOrNull(1) == "result") q["paymentId"]?.takeIf { it.isNotBlank() }?.let {
            DeepLink.PaymentResult(it, enumOrNull<PaymentStatus>(q["status"]?.uppercase()))
        } else null
        "booking", "bookings" -> s.getOrNull(1)?.let { DeepLink.Booking(it) } ?: DeepLink.Bookings
        "chat", "messages", "conversations" -> s.getOrNull(1)?.let { DeepLink.Conversation(it) }
        "page", "pages" -> s.getOrNull(1)?.let { DeepLink.Page(it) }
        "agency", "agencies" -> s.getOrNull(1)?.let { DeepLink.Agency(it) }
        "notifications" -> DeepLink.Notifications
        "me", "cabinet" -> when (s.getOrNull(1)) {
            "wallet" -> DeepLink.Wallet
            "listings" -> DeepLink.MyListings
            "bookings" -> DeepLink.Bookings
            "business" -> DeepLink.Business
            "saved-searches" -> DeepLink.SavedSearches
            "notifications" -> DeepLink.Notifications
            else -> null
        }
        in CMS_SLUGS -> DeepLink.Page(s.first())
        else -> null
    }

    private fun pathSegments(rawPath: String?): List<String> =
        rawPath.orEmpty().split('/').filter { it.isNotBlank() }.map { URLDecoder.decode(it, Charsets.UTF_8.name()) }

    fun parseQuery(raw: String?): Map<String, String> {
        if (raw.isNullOrBlank()) return emptyMap()
        return raw.split('&').mapNotNull { pair ->
            if (pair.isBlank()) return@mapNotNull null
            val i = pair.indexOf('=')
            val k = URLDecoder.decode(if (i < 0) pair else pair.substring(0, i), Charsets.UTF_8.name())
            val v = if (i < 0) "" else URLDecoder.decode(pair.substring(i + 1), Charsets.UTF_8.name())
            k to v
        }.toMap()
    }
}
