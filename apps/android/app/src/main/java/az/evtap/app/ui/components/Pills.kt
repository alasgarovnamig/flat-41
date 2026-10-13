package az.evtap.app.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import az.evtap.app.R
import az.evtap.app.ui.common.PriceParts
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.format.Format
import az.evtap.core.model.BookingStatus
import az.evtap.core.model.Currency
import az.evtap.core.model.DealType
import az.evtap.core.model.ListingLike
import az.evtap.core.model.ListingStatus
import az.evtap.core.model.PaymentStatus

/** Choice chip: active = black pill + white text, inactive = `pill` grey (DESIGN_SYSTEM "Pills everywhere"). */
@Composable
fun ChoiceChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    onCanvas: Boolean = true,
) {
    val c = EvTheme.colors
    val bg = if (selected) c.ink else if (onCanvas) c.pill else c.surfaceRaised
    val fg = if (selected) c.onInk else c.ink
    Row(
        modifier
            .heightIn(min = 40.dp)
            .clip(RoundedCornerShape(50))
            .background(bg)
            .pressable(onClick, role = Role.Checkbox)
            .semantics { this.selected = selected }
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        if (icon != null) Icon(icon, null, tint = fg, modifier = Modifier.size(16.dp))
        Text(label, style = EvTheme.type.label, color = fg, maxLines = 1)
    }
}

/** Filter pill: 44 dp, leading line icon + label + chevron; selected = 1.5 dp ink outline. */
@Composable
fun FilterPill(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    selected: Boolean = false,
    onCanvas: Boolean = true,
    showChevron: Boolean = true,
    count: Int = 0,
) {
    val c = EvTheme.colors
    val shape = RoundedCornerShape(50)
    Row(
        modifier
            .heightIn(min = 44.dp)
            .clip(shape)
            .background(if (onCanvas) c.pill else c.surfaceRaised)
            .border(BorderStroke(1.5.dp, if (selected) c.ink else Color.Transparent), shape)
            .pressable(onClick)
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (icon != null) Icon(icon, null, tint = c.ink, modifier = Modifier.size(18.dp))
        Text(label, style = EvTheme.type.label, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (count > 0) CountBubble(count)
        if (showChevron) Icon(EvIcons.ChevronDown, null, tint = c.inkSecondary, modifier = Modifier.size(16.dp))
    }
}

@Composable
fun CountBubble(count: Int, modifier: Modifier = Modifier) {
    val c = EvTheme.colors
    Box(
        modifier.heightIn(min = 20.dp).clip(RoundedCornerShape(50)).background(c.ink).padding(horizontal = 7.dp, vertical = 2.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(if (count > 99) "99+" else count.toString(), style = EvTheme.type.micro, color = c.onInk)
    }
}

/** Small rounded tag (badges, statuses, spec chips). */
@Composable
fun Tag(
    text: String,
    modifier: Modifier = Modifier,
    background: Color = EvTheme.colors.pill,
    content: Color = EvTheme.colors.ink,
    icon: ImageVector? = null,
    dot: Color? = null,
) {
    Row(
        modifier.clip(RoundedCornerShape(50)).background(background).padding(horizontal = 9.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        if (dot != null) Box(Modifier.size(6.dp).clip(CircleShape).background(dot))
        if (icon != null) Icon(icon, null, tint = content, modifier = Modifier.size(12.dp))
        Text(text, style = EvTheme.type.micro, color = content, maxLines = 1)
    }
}

/** Black "+10%" delta tag of the PillBarChart / StatCards. */
@Composable
fun DeltaTag(text: String, modifier: Modifier = Modifier) =
    Tag(text, modifier, background = EvTheme.colors.ink, content = EvTheme.colors.onInk)

/** Spec chip "85 m²" — 11 sp muted pill. */
@Composable
fun SpecChip(text: String, modifier: Modifier = Modifier, icon: ImageVector? = null) =
    Tag(text, modifier, background = EvTheme.colors.surfaceSunken, content = EvTheme.colors.inkSecondary, icon = icon)

@Composable fun VipBadge() = Tag(stringResource(R.string.badge_vip), background = EvTheme.colors.vipBg, content = EvTheme.colors.vip, icon = EvIcons.StarFilled)
@Composable fun PremiumBadge() = Tag(stringResource(R.string.badge_premium), background = EvTheme.colors.premium, content = EvTheme.colors.onInk, icon = EvIcons.Sparkles)
@Composable fun UrgentBadge() = Tag(stringResource(R.string.badge_urgent), background = EvTheme.colors.dangerBg, content = EvTheme.colors.danger, dot = EvTheme.colors.danger)
@Composable fun VerifiedBadge() = Tag(stringResource(R.string.badge_verified), background = EvTheme.colors.successBg, content = EvTheme.colors.success, icon = EvIcons.Check)
@Composable fun BusinessBadge() = Tag(stringResource(R.string.badge_business), background = EvTheme.colors.pill, content = EvTheme.colors.ink, icon = EvIcons.Briefcase)

/** Promotion / trust badges of a listing, in priority order. */
@Composable
fun ListingBadges(l: ListingLike, modifier: Modifier = Modifier, includeBusiness: Boolean = false) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (l.isPremium) PremiumBadge()
        if (l.isVip) VipBadge()
        if (l.isUrgent) UrgentBadge()
        if (l.isVerified) VerifiedBadge()
        if (includeBusiness && l.isBusiness) BusinessBadge()
    }
}

/** Status colours never stand alone: always text + colour. */
@Composable
fun StatusTag(status: ListingStatus) {
    val c = EvTheme.colors
    val (bg, fg) = when (status) {
        ListingStatus.ACTIVE -> c.successBg to c.success
        ListingStatus.PENDING, ListingStatus.DRAFT -> c.warningBg to c.warning
        ListingStatus.REJECTED, ListingStatus.BLOCKED -> c.dangerBg to c.danger
        else -> c.pill to c.inkSecondary
    }
    Tag(stringResource(az.evtap.app.ui.common.Labels.listingStatus(status)), background = bg, content = fg)
}

@Composable
fun BookingStatusTag(status: BookingStatus) {
    val c = EvTheme.colors
    val (bg, fg) = when (status) {
        BookingStatus.CONFIRMED, BookingStatus.COMPLETED -> c.successBg to c.success
        BookingStatus.PENDING_PAYMENT -> c.warningBg to c.warning
        BookingStatus.CANCELLED -> c.dangerBg to c.danger
        BookingStatus.REFUNDED -> c.infoBg to c.info
    }
    Tag(stringResource(az.evtap.app.ui.common.Labels.bookingStatus(status)), background = bg, content = fg)
}

@Composable
fun PaymentStatusTag(status: PaymentStatus) {
    val c = EvTheme.colors
    val (bg, fg) = when (status) {
        PaymentStatus.SUCCEEDED -> c.successBg to c.success
        PaymentStatus.CREATED, PaymentStatus.PENDING -> c.warningBg to c.warning
        PaymentStatus.FAILED, PaymentStatus.CANCELLED -> c.dangerBg to c.danger
        PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED -> c.infoBg to c.info
    }
    Tag(stringResource(az.evtap.app.ui.common.Labels.paymentStatus(status)), background = bg, content = fg)
}

/** Colour of the "• For Rent" dot on property cards. */
@Composable
fun dealColor(d: DealType): Color = when (d) {
    DealType.SALE -> EvTheme.colors.accentStrong
    DealType.RENT_LONG -> EvTheme.colors.info
    DealType.RENT_DAILY -> EvTheme.colors.success
}

/**
 * "₼ 125 000 / ay": currency symbol grey and lighter, number in ink, period muted & small (DESIGN_SYSTEM
 * "Big quiet numbers").
 */
@Composable
fun priceAnnotated(parts: PriceParts, numberColor: Color = EvTheme.colors.ink, periodSize: TextUnit = TextUnit.Unspecified): AnnotatedString {
    val c = EvTheme.colors
    val period = parts.periodRes?.let { stringResource(it) }
    return buildAnnotatedString {
        withStyle(SpanStyle(color = c.muted, fontWeight = FontWeight.Light)) { append(parts.symbol) }
        append(' ')
        withStyle(SpanStyle(color = numberColor)) { append(parts.number) }
        if (period != null) withStyle(SpanStyle(color = c.muted, fontSize = periodSize)) { append(" $period") }
    }
}

@Composable
fun PriceText(parts: PriceParts, modifier: Modifier = Modifier, style: TextStyle = EvTheme.type.bodyStrong) {
    Text(
        priceAnnotated(parts, periodSize = style.fontSize * 0.75f),
        modifier,
        style = style,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/** Minor-unit amount as a KPI: "₼ 1 250.00" with grey symbol. */
@Composable
fun MoneyText(minor: Long, modifier: Modifier = Modifier, currency: Currency = Currency.AZN, style: TextStyle = EvTheme.type.number, color: Color = EvTheme.colors.ink) {
    val c = EvTheme.colors
    Text(
        buildAnnotatedString {
            withStyle(SpanStyle(color = c.muted)) { append(currency.symbol) }
            append(' ')
            withStyle(SpanStyle(color = color)) { append(Format.moneyNumber(minor)) }
        },
        modifier,
        style = style,
        maxLines = 1,
    )
}
