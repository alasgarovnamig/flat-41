package az.evtap.app.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import az.evtap.app.R
import az.evtap.app.ui.common.Labels
import az.evtap.app.ui.common.LocalAppContainer
import az.evtap.app.ui.common.LocalAppLocale
import az.evtap.app.ui.common.factsLine
import az.evtap.app.ui.common.labelFor
import az.evtap.app.ui.common.priceParts
import az.evtap.app.ui.common.priceText
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.theme.EvRadius
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.format.Format
import az.evtap.core.model.ListingLike

/**
 * PropertyCard (DESIGN_SYSTEM): white card radius 22; 4:3 photo fading into the white body; top-right white heart
 * circle + black ↗ circle; meta row "• Satış" (dot coloured by deal type) + orange ★ rating; title 15/500,
 * address 12 muted, price right (₼ muted + value ink); spec chips (m², rooms, floor) in 11 sp muted pills.
 */
@Composable
fun PropertyCard(
    item: ListingLike,
    isFavorite: Boolean,
    onClick: () -> Unit,
    onToggleFavorite: () -> Unit,
    modifier: Modifier = Modifier,
    imageAspect: Float = 4f / 3f,
) {
    val c = EvTheme.colors
    val locations = LocalAppContainer.current.locations
    val locale = LocalAppLocale.current
    val shape = RoundedCornerShape(EvRadius.lg)
    val body = if (item.isHighlighted) c.highlightBg else c.surfaceRaised
    val title = item.title
    val price = item.priceText()
    val place = remember(item.id, item.address, locale) { listOfNotNull(item.address?.takeIf { it.isNotBlank() }, locations.labelFor(item, locale)).joinToString(", ") }
    val openLabel = stringResource(R.string.my_listings_view)
    Column(
        modifier
            .softShadow(shape)
            .clip(shape)
            .background(body)
            .pressable(onClick, onClickLabel = openLabel)
            .semantics(mergeDescendants = true) { contentDescription = "$title, $price, $place" },
    ) {
        Box(Modifier.fillMaxWidth().aspectRatio(imageAspect)) {
            EvImage(item.coverUrl, null, Modifier.fillMaxSize().clip(RoundedCornerShape(topStart = EvRadius.lg, topEnd = EvRadius.lg)))
            // bottom fade into the card body
            Box(
                Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(72.dp)
                    .background(Brush.verticalGradient(listOf(Color.Transparent, body))),
            )
            ListingBadges(item, Modifier.align(Alignment.TopStart).padding(12.dp))
            Row(Modifier.align(Alignment.TopEnd).padding(6.dp), horizontalArrangement = Arrangement.spacedBy(0.dp)) {
                HeartButton(isFavorite, stringResource(R.string.tabs_favorites), onToggleFavorite)
                OpenArrowButton(openLabel, onClick)
            }
            if (item.imagesCount > 1) {
                Tag(
                    stringResource(R.string.common_photos, item.imagesCount),
                    Modifier.align(Alignment.BottomEnd).padding(12.dp),
                    background = Color.Black.copy(alpha = 0.45f),
                    content = Color.White,
                    icon = EvIcons.Image,
                )
            }
        }
        Column(Modifier.padding(start = 14.dp, end = 14.dp, top = 2.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    Box(Modifier.size(6.dp).clip(CircleShape).background(dealColor(item.dealType)))
                    Text(stringResource(Labels.deal(item.dealType)), style = EvTheme.type.micro, color = c.inkSecondary)
                }
                item.rating?.let { r ->
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
                        Icon(EvIcons.StarFilled, null, tint = c.star, modifier = Modifier.size(12.dp))
                        Text(String.format(java.util.Locale.US, "%.1f", r), style = EvTheme.type.micro, color = c.inkSecondary)
                    }
                }
                if (item.isBusiness) Text(stringResource(R.string.badge_business), style = EvTheme.type.micro, color = c.muted)
            }
            Row(verticalAlignment = Alignment.Top) {
                Column(Modifier.weight(1f).padding(end = 8.dp)) {
                    Text(title, style = EvTheme.type.bodyStrong, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(place, style = EvTheme.type.caption, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                PriceText(item.priceParts(), style = EvTheme.type.bodyStrong)
            }
            SpecChips(item, Modifier.padding(top = 4.dp))
        }
    }
}

@Composable
fun SpecChips(item: ListingLike, modifier: Modifier = Modifier) {
    val m2 = stringResource(R.string.common_m2)
    FlowRow(modifier.clearAndSetSemantics { }, horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (item.area > 0) SpecChip("${Format.area(item.area)} $m2", icon = EvIcons.Ruler)
        item.landArea?.takeIf { it > 0 }?.let { SpecChip("${Format.area(it)} ${stringResource(R.string.common_sot)}", icon = EvIcons.Trees) }
        item.rooms?.takeIf { it > 0 }?.let { SpecChip(stringResource(R.string.common_rooms_short, it), icon = EvIcons.Bed) }
        item.floor?.let { f ->
            SpecChip(item.totalFloors?.let { stringResource(R.string.common_floor_of, f, it) } ?: f.toString(), icon = EvIcons.Layers)
        }
    }
}

/**
 * Compact horizontal row (my listings, chat header, booking, map selection): 88 dp thumbnail + title / place / price.
 */
@Composable
fun PropertyRow(
    item: ListingLike,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    thumb: Dp = 88.dp,
    trailing: (@Composable () -> Unit)? = null,
) {
    val c = EvTheme.colors
    val locations = LocalAppContainer.current.locations
    val locale = LocalAppLocale.current
    Row(
        modifier.fillMaxWidth().clip(RoundedCornerShape(EvRadius.lg)).background(if (item.isHighlighted) c.highlightBg else c.surfaceRaised)
            .pressable(onClick).padding(10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        EvImage(item.coverUrl, null, Modifier.size(thumb).clip(RoundedCornerShape(EvRadius.md)))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(item.title, style = EvTheme.type.bodyStrong, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(locations.labelFor(item, locale), style = EvTheme.type.caption, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            PriceText(item.priceParts(), style = EvTheme.type.bodyStrong)
            Text(item.factsLine(), style = EvTheme.type.caption, color = c.inkSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        trailing?.invoke()
    }
}

/** Fixed-width card for horizontal carousels (Premium on Home, similar listings). */
@Composable
fun CarouselPropertyCard(item: ListingLike, isFavorite: Boolean, onClick: () -> Unit, onToggleFavorite: () -> Unit, width: Dp = 280.dp) =
    PropertyCard(item, isFavorite, onClick, onToggleFavorite, Modifier.width(width), imageAspect = 4f / 3.4f)
