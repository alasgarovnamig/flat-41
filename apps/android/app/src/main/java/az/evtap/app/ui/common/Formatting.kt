package az.evtap.app.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.res.stringResource
import az.evtap.app.AppContainer
import az.evtap.app.R
import az.evtap.app.platform.AppLanguage
import az.evtap.core.format.Format
import az.evtap.core.locations.Locations
import az.evtap.core.model.AppLocale
import az.evtap.core.model.ListingLike
import az.evtap.core.model.PricePeriod
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

val LocalAppContainer = staticCompositionLocalOf<AppContainer> { error("AppContainer not provided") }
val LocalAppLocale = staticCompositionLocalOf { AppLocale.AZ }

/** Uploads may be relative (`/uploads/…`) when the API stores files locally. */
fun absUrl(origin: String, url: String?): String? = when {
    url.isNullOrBlank() -> null
    url.startsWith("http://") || url.startsWith("https://") || url.startsWith("content:") || url.startsWith("file:") -> url
    else -> origin.trimEnd('/') + (if (url.startsWith("/")) "" else "/") + url
}

@Composable
@ReadOnlyComposable
fun imageUrl(url: String?): String? = absUrl(LocalAppContainer.current.apiOrigin, url)

object Dates {
    private val zone: ZoneId get() = ZoneId.systemDefault()

    fun instant(iso: String?): Instant? = iso?.takeIf { it.isNotBlank() }?.let {
        runCatching { Instant.parse(it) }.getOrNull()
            ?: runCatching { OffsetDateTime.parse(it).toInstant() }.getOrNull()
            ?: runCatching { LocalDateTime.parse(it).atZone(zone).toInstant() }.getOrNull()
            ?: runCatching { LocalDate.parse(it.take(10)).atStartOfDay(zone).toInstant() }.getOrNull()
    }

    fun localDate(iso: String?): LocalDate? = iso?.let {
        if (it.length == 10) runCatching { LocalDate.parse(it) }.getOrNull() else instant(it)?.atZone(zone)?.toLocalDate()
    }

    /** "12 okt. 2026" in the UI language. */
    fun date(iso: String?, locale: Locale = AppLanguage.javaLocale()): String =
        localDate(iso)?.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)) ?: ""

    fun date(d: LocalDate, locale: Locale = AppLanguage.javaLocale()): String =
        d.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale))

    /** "12 okt." — short day + month for ranges. */
    fun dayMonth(d: LocalDate, locale: Locale = AppLanguage.javaLocale()): String =
        d.format(DateTimeFormatter.ofPattern("d MMM", locale))

    fun dateTime(iso: String?, locale: Locale = AppLanguage.javaLocale()): String =
        instant(iso)?.atZone(zone)?.format(DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT).withLocale(locale)) ?: ""

    fun time(iso: String?): String = instant(iso)?.atZone(zone)?.format(DateTimeFormatter.ofPattern("HH:mm")) ?: ""

    fun monthTitle(year: Int, month: Int, locale: Locale = AppLanguage.javaLocale()): String =
        LocalDate.of(year, month, 1).format(DateTimeFormatter.ofPattern("LLLL yyyy", locale)).replaceFirstChar { it.titlecase(locale) }

    fun isToday(iso: String?): Boolean = localDate(iso) == LocalDate.now(zone)
    fun isYesterday(iso: String?): Boolean = localDate(iso) == LocalDate.now(zone).minusDays(1)
}

/** "14:05" today, "Dünən" yesterday, else the date — for chat / notification lists. */
@Composable
fun relativeTime(iso: String?): String = when {
    Dates.isToday(iso) -> Dates.time(iso)
    Dates.isYesterday(iso) -> stringResource(R.string.common_yesterday)
    else -> Dates.date(iso)
}

/** "125 000" + "₼" + optional "/ ay" — the parts of a price, so the UI can grey out the currency. */
data class PriceParts(val number: String, val symbol: String, val periodRes: Int?)

fun ListingLike.priceParts(): PriceParts = priceParts(price, currency.symbol, pricePeriod)

fun priceParts(major: Long, symbol: String, period: PricePeriod): PriceParts = PriceParts(
    number = Format.groupThousands(major),
    symbol = symbol,
    periodRes = when (period) {
        PricePeriod.MONTH -> R.string.common_per_month
        PricePeriod.DAY -> R.string.common_per_night
        PricePeriod.TOTAL -> null
    },
)

/** Plain-text price for share sheets / accessibility: "125 000 ₼ / ay". */
@Composable
fun ListingLike.priceText(): String {
    val p = priceParts()
    return listOfNotNull("${p.number} ${p.symbol}", p.periodRes?.let { stringResource(it) }).joinToString(" ")
}

/** "3 otaqlı · 85 m² · 5/12 mərtəbə". */
@Composable
fun ListingLike.factsLine(): String = listOfNotNull(
    rooms?.takeIf { it > 0 }?.let { stringResource(R.string.common_rooms_short, it) },
    area.takeIf { it > 0 }?.let { "${Format.area(it)} ${stringResource(R.string.common_m2)}" },
    landArea?.takeIf { it > 0 }?.let { "${Format.area(it)} ${stringResource(R.string.common_sot)}" },
    floor?.let { f -> totalFloors?.let { stringResource(R.string.common_floor_of, f, it) } ?: "$f" },
).joinToString(" · ")

fun Locations.labelFor(l: ListingLike, locale: AppLocale): String = label(l.cityId, l.districtId, l.metroId, locale)
