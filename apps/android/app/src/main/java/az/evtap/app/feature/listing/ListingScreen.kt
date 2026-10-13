package az.evtap.app.feature.listing

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import az.evtap.app.R
import az.evtap.app.platform.Intents
import az.evtap.app.ui.common.Dates
import az.evtap.app.ui.common.Labels
import az.evtap.app.ui.common.LocalAppContainer
import az.evtap.app.ui.common.LocalAppLocale
import az.evtap.app.ui.common.Load
import az.evtap.app.ui.common.appViewModel
import az.evtap.app.ui.common.labelFor
import az.evtap.app.ui.common.priceParts
import az.evtap.app.ui.common.priceText
import az.evtap.app.ui.components.Avatar
import az.evtap.app.ui.components.BusinessBadge
import az.evtap.app.ui.components.CarouselPropertyCard
import az.evtap.app.ui.components.CircleStyle
import az.evtap.app.ui.components.EvCard
import az.evtap.app.ui.components.EvImage
import az.evtap.app.ui.components.EvScreen
import az.evtap.app.ui.components.ErrorState
import az.evtap.app.ui.components.HeartButton
import az.evtap.app.ui.components.IconCircleButton
import az.evtap.app.ui.components.ListingBadges
import az.evtap.app.ui.components.LoadingBox
import az.evtap.app.ui.components.NoticeBanner
import az.evtap.app.ui.components.NoticeTone
import az.evtap.app.ui.components.PillButton
import az.evtap.app.ui.components.PillKind
import az.evtap.app.ui.components.PillSize
import az.evtap.app.ui.components.PriceText
import az.evtap.app.ui.components.SectionHeader
import az.evtap.app.ui.components.SpecChip
import az.evtap.app.ui.components.StaticPinMap
import az.evtap.app.ui.components.StatusTag
import az.evtap.app.ui.components.Tag
import az.evtap.app.ui.components.pressable
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.navigation.BookRoute
import az.evtap.app.ui.navigation.GalleryRoute
import az.evtap.app.ui.navigation.HostCalendarRoute
import az.evtap.app.ui.navigation.ListingStatsRoute
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.navigation.NewChatRoute
import az.evtap.app.ui.navigation.PostRoute
import az.evtap.app.ui.navigation.PromoteRoute
import az.evtap.app.ui.navigation.ReviewsRoute
import az.evtap.app.ui.theme.EvRadius
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.format.Format
import az.evtap.core.model.DealType
import az.evtap.core.model.ListingDetail
import az.evtap.core.model.ListingStatus

@Composable
fun ListingScreen(id: String) {
    val vm = appViewModel(key = "listing-$id") { ListingViewModel(id, it) }
    val load by vm.detail.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    when (val l = load) {
        Load.Loading -> EvScreen(topBar = { az.evtap.app.ui.components.EvTopBar(null, navigator::back) }) { LoadingBox(Modifier.padding(it)) }
        is Load.Failed -> EvScreen(topBar = { az.evtap.app.ui.components.EvTopBar(null, navigator::back) }) {
            ErrorState(l.error, onRetry = vm::load, modifier = Modifier.padding(it))
        }
        is Load.Ready -> ListingDetailContent(l.data, vm)
    }
}

@Composable
private fun ListingDetailContent(l: ListingDetail, vm: ListingViewModel) {
    val navigator = LocalNavigator.current
    val container = LocalAppContainer.current
    val context = LocalContext.current
    val favorites by container.favorites.ids.collectAsStateWithLifecycle()
    val similar by vm.similar.collectAsStateWithLifecycle()
    val reviews by vm.reviews.collectAsStateWithLifecycle()
    val c = EvTheme.colors
    val isFav = l.id in favorites
    val daily = l.dealType == DealType.RENT_DAILY
    val listingUrl = "${container.webUrl}/${LocalAppLocale.current.tag}/listings/${l.id}"
    val priceStr = l.priceText()
    val shareText = stringResource(R.string.listing_share_text, l.title, priceStr, listingUrl)
    val waText = stringResource(R.string.listing_whatsapp_text, listingUrl)
    var reportOpen by rememberSaveable { mutableStateOf(false) }
    var mortgageApplyOpen by rememberSaveable { mutableStateOf(false) }
    val mortgage = rememberMortgageState()
    val refreshing by vm.refreshing.collectAsStateWithLifecycle()
    val scope = androidx.compose.runtime.rememberCoroutineScope()

    EvScreen(
        bottomBar = if (l.isOwner) null else ({ ContactBar(l, vm, waText) }),
    ) { padding ->
        PullToRefreshBox(isRefreshing = refreshing, onRefresh = vm::refresh, modifier = Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = padding.calculateBottomPadding() + 24.dp)) {
                Gallery(l, isFav, shareText, onFav = { navigator.requireAuth { vm.toggleFavorite() } })

                Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                    if (l.status != ListingStatus.ACTIVE || l.isOwner) OwnerPanel(l)

                    // ── Price + title
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        ListingBadges(l, includeBusiness = true)
                        PriceText(l.priceParts(), style = EvTheme.type.display)
                        if (l.dealType == DealType.SALE && l.area > 0) {
                            Text(
                                stringResource(R.string.listing_price_per_m2, Format.price(Format.pricePerM2(l.price, l.area), l.currency)),
                                style = EvTheme.type.label,
                                color = c.muted,
                            )
                        }
                        Text(l.title, style = EvTheme.type.h2, modifier = Modifier.semantics { heading() })
                        val locale = LocalAppLocale.current
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Icon(EvIcons.MapPin, null, tint = c.muted, modifier = Modifier.size(16.dp))
                            Text(
                                listOfNotNull(l.address?.takeIf { it.isNotBlank() }, container.locations.labelFor(l, locale)).joinToString(", "),
                                style = EvTheme.type.body,
                                color = c.inkSecondary,
                            )
                        }
                        if (daily && l.rating != null) {
                            Row(
                                Modifier.pressable({ navigator.open(ReviewsRoute(l.id)) }),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Stars(l.rating ?: 0.0)
                                Text(
                                    String.format(java.util.Locale.US, "%.1f", l.rating) + " · " + stringResource(R.string.listing_reviews_count, l.reviewsCount),
                                    style = EvTheme.type.label,
                                    color = c.inkSecondary,
                                )
                            }
                        }
                    }

                    FactsCard(l)

                    if (l.description.isNotBlank()) DescriptionCard(l.description)

                    if (l.amenities.isNotEmpty()) {
                        EvCard(Modifier.fillMaxWidth()) {
                            Text(stringResource(R.string.listing_amenities), style = EvTheme.type.h3)
                            Spacer(Modifier.height(12.dp))
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                l.amenities.forEach { a -> Tag(stringResource(Labels.amenity(a)), background = c.surfaceRaised, icon = EvIcons.Check) }
                            }
                        }
                    }

                    if (daily && !l.houseRules.isNullOrBlank()) {
                        EvCard(Modifier.fillMaxWidth()) {
                            Text(stringResource(R.string.listing_house_rules), style = EvTheme.type.h3)
                            Spacer(Modifier.height(8.dp))
                            Text(l.houseRules.orEmpty(), style = EvTheme.type.body, color = c.inkSecondary)
                        }
                    }

                    LocationCard(l)

                    OwnerCard(l)

                    if (daily) ReviewsPreview(l, reviews) { navigator.open(ReviewsRoute(l.id)) }

                    if (l.dealType == DealType.SALE && !l.isOwner) {
                        val banks by vm.banks.collectAsStateWithLifecycle()
                        MortgageCalculatorCard(l.price, banks, mortgage, onApply = { mortgageApplyOpen = true })
                    }

                    // ── Meta + report
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(stringResource(R.string.listing_id, l.id.take(8)), style = EvTheme.type.caption, color = c.muted)
                            Text(stringResource(R.string.listing_updated, Dates.date(l.updatedAt.ifBlank { l.bumpedAt })), style = EvTheme.type.caption, color = c.muted)
                            Text("${stringResource(R.string.common_views)}: ${l.views}", style = EvTheme.type.caption, color = c.muted)
                        }
                        if (!l.isOwner) {
                            PillButton(stringResource(R.string.listing_report), { reportOpen = true }, kind = PillKind.Ghost, size = PillSize.Small, icon = EvIcons.Flag)
                        }
                    }
                }

                if (similar.isNotEmpty()) {
                    SectionHeader(stringResource(R.string.listing_similar), Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp))
                    LazyRow(contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        items(similar, key = { it.id }) { s ->
                            CarouselPropertyCard(s, s.id in favorites, { navigator.openListing(s.id) }, {
                                navigator.requireAuth {
                                    scope.launch { runCatching { container.favorites.toggle(s.id) }.onFailure { container.toaster.error(it) } }
                                }
                            }, width = 260.dp)
                        }
                    }
                }
            }
        }
    }

    if (reportOpen) ReportSheet(vm, onDismiss = { reportOpen = false })
    if (mortgageApplyOpen) MortgageLeadSheet(vm, l.price, mortgage, onDismiss = { mortgageApplyOpen = false })
}

@Composable
private fun Gallery(l: ListingDetail, isFav: Boolean, shareText: String, onFav: () -> Unit) {
    val navigator = LocalNavigator.current
    val context = LocalContext.current
    val c = EvTheme.colors
    val images = l.sortedImages
    val pager = rememberPagerState { images.size.coerceAtLeast(1) }
    Box(Modifier.fillMaxWidth().height(340.dp)) {
        if (images.isEmpty()) {
            EvImage(l.coverUrl, l.title, Modifier.fillMaxSize())
        } else {
            HorizontalPager(pager, Modifier.fillMaxSize(), key = { images[it].id }) { page ->
                EvImage(
                    images[page].url,
                    l.title + " " + (page + 1),
                    Modifier.fillMaxSize().pressable({ navigator.open(GalleryRoute(l.id, page)) }),
                )
            }
        }
        // fade into the canvas (PropertyCard language at page scale)
        Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(90.dp).background(Brush.verticalGradient(listOf(Color.Transparent, c.canvas))))
        Row(
            Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconCircleButton(EvIcons.ChevronLeft, stringResource(R.string.common_back), navigator::back, style = CircleStyle.Glass)
            Spacer(Modifier.weight(1f))
            IconCircleButton(EvIcons.Share, stringResource(R.string.common_share), { Intents.share(context, l.title, shareText) }, style = CircleStyle.Glass)
            HeartButton(isFav, stringResource(R.string.tabs_favorites), onFav, size = 44.dp)
        }
        if (images.size > 1) {
            Tag(
                "${pager.currentPage + 1} / ${images.size}",
                Modifier.align(Alignment.BottomEnd).padding(end = 20.dp, bottom = 28.dp),
                background = Color.Black.copy(alpha = 0.5f),
                content = Color.White,
            )
        }
    }
}

@Composable
private fun OwnerPanel(l: ListingDetail) {
    val navigator = LocalNavigator.current
    EvCard(Modifier.fillMaxWidth(), color = EvTheme.colors.highlightBg) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(
                if (l.isOwner) stringResource(R.string.listing_your_listing) else stringResource(R.string.listing_not_active),
                style = EvTheme.type.bodyStrong,
                modifier = Modifier.weight(1f),
            )
            StatusTag(l.status)
        }
        l.rejectionReason?.let {
            Spacer(Modifier.height(8.dp))
            NoticeBanner(stringResource(R.string.my_listings_rejected, it), tone = NoticeTone.Danger)
        }
        if (l.isOwner) {
            Spacer(Modifier.height(12.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                PillButton(stringResource(R.string.common_edit), { navigator.open(PostRoute(l.id)) }, size = PillSize.Small, icon = EvIcons.Pencil)
                PillButton(stringResource(R.string.promote_title), { navigator.open(PromoteRoute(l.id)) }, size = PillSize.Small, kind = PillKind.Secondary, icon = EvIcons.Sparkles)
                PillButton(stringResource(R.string.my_listings_stats), { navigator.open(ListingStatsRoute(l.id)) }, size = PillSize.Small, kind = PillKind.Secondary, icon = EvIcons.BarChart)
                if (l.dealType == DealType.RENT_DAILY) {
                    PillButton(stringResource(R.string.my_listings_calendar), { navigator.open(HostCalendarRoute(l.id)) }, size = PillSize.Small, kind = PillKind.Secondary, icon = EvIcons.Calendar)
                }
            }
            if (l.promotions.isNotEmpty()) {
                Spacer(Modifier.height(10.dp))
                val services by LocalAppContainer.current.catalog.catalog.collectAsStateWithLifecycle()
                val locale = LocalAppLocale.current
                l.promotions.forEach { p ->
                    val name = services.services.firstOrNull { it.code == p.serviceCode }?.name?.get(locale) ?: p.type.name
                    Text(
                        "✓ $name" + (p.endsAt?.let { " · " + stringResource(R.string.promote_active, Dates.date(it)) } ?: ""),
                        style = EvTheme.type.caption,
                        color = EvTheme.colors.success,
                    )
                }
            }
        }
    }
}

@Composable
private fun FactsCard(l: ListingDetail) {
    val c = EvTheme.colors
    val daily = l.dealType == DealType.RENT_DAILY
    val yes = stringResource(R.string.common_yes)
    val no = stringResource(R.string.common_no)
    val rows = listOf(
        stringResource(R.string.listing_deal_type) to stringResource(Labels.deal(l.dealType)),
        stringResource(R.string.listing_property_type) to stringResource(Labels.property(l.propertyType)),
        stringResource(R.string.listing_building_type) to l.buildingType?.let { stringResource(Labels.building(it)) },
        stringResource(R.string.listing_area) to l.area.takeIf { it > 0 }?.let { "${Format.area(it)} ${stringResource(R.string.common_m2)}" },
        stringResource(R.string.listing_land_area) to l.landArea?.let { "${Format.area(it)} ${stringResource(R.string.common_sot)}" },
        stringResource(R.string.listing_rooms) to l.rooms?.toString(),
        stringResource(R.string.listing_bathrooms) to l.bathrooms?.toString(),
        stringResource(R.string.listing_floor) to l.floor?.let { f -> l.totalFloors?.let { "$f / $it" } ?: "$f" },
        stringResource(R.string.listing_year_built) to l.yearBuilt?.toString(),
        stringResource(R.string.listing_ceiling_height) to l.ceilingHeight?.let { "$it m" },
        stringResource(R.string.listing_repair) to l.repair?.let { stringResource(Labels.repair(it)) },
        stringResource(R.string.listing_document) to (if (l.dealType == DealType.SALE) (if (l.hasDocument) yes else no) else null),
        stringResource(R.string.listing_mortgage) to (if (l.dealType == DealType.SALE) (if (l.mortgageAvailable) yes else no) else null),
        stringResource(R.string.listing_max_guests) to (if (daily) l.maxGuests?.toString() else null),
        stringResource(R.string.listing_min_nights) to (if (daily) l.minNights?.toString() else null),
        stringResource(R.string.listing_check_in_time) to (if (daily) l.checkInTime else null),
        stringResource(R.string.listing_check_out_time) to (if (daily) l.checkOutTime else null),
    ).filter { it.second != null }
    EvCard(Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.listing_details), style = EvTheme.type.h3, modifier = Modifier.semantics { heading() })
        Spacer(Modifier.height(12.dp))
        // 2-column grid of fact "chips"
        rows.chunked(2).forEach { pair ->
            Row(Modifier.fillMaxWidth().padding(bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                pair.forEach { (label, value) ->
                    Column(
                        Modifier.weight(1f).clip(RoundedCornerShape(EvRadius.md)).background(c.surfaceRaised).padding(horizontal = 12.dp, vertical = 10.dp)
                            .semantics(mergeDescendants = true) { },
                    ) {
                        Text(label, style = EvTheme.type.caption, color = c.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(value.orEmpty(), style = EvTheme.type.bodyStrong, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun DescriptionCard(text: String) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    val long = text.length > 280
    EvCard(Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.listing_description), style = EvTheme.type.h3, modifier = Modifier.semantics { heading() })
        Spacer(Modifier.height(8.dp))
        Text(
            text,
            style = EvTheme.type.body,
            color = EvTheme.colors.inkSecondary,
            maxLines = if (expanded || !long) Int.MAX_VALUE else 6,
            overflow = TextOverflow.Ellipsis,
        )
        if (long) {
            PillButton(
                stringResource(if (expanded) R.string.listing_show_less else R.string.listing_show_more),
                { expanded = !expanded },
                kind = PillKind.Ghost,
                size = PillSize.Small,
                trailingIcon = if (expanded) EvIcons.ChevronUp else EvIcons.ChevronDown,
            )
        }
    }
}

@Composable
private fun LocationCard(l: ListingDetail) {
    val container = LocalAppContainer.current
    val locale = LocalAppLocale.current
    val context = LocalContext.current
    val lat = l.lat
    val lng = l.lng
    EvCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.listing_location), style = EvTheme.type.h3, modifier = Modifier.weight(1f).semantics { heading() })
            if (lat != null && lng != null) {
                IconCircleButton(
                    EvIcons.Maximize,
                    stringResource(R.string.listing_open_in_maps),
                    { Intents.openBrowser(context, "https://www.google.com/maps/search/?api=1&query=$lat,$lng") },
                    style = CircleStyle.Raised,
                    size = 36.dp,
                    iconSize = 16.dp,
                )
            }
        }
        Spacer(Modifier.height(10.dp))
        Text(
            listOfNotNull(l.address?.takeIf { it.isNotBlank() }, container.locations.labelFor(l, locale)).joinToString(", "),
            style = EvTheme.type.body,
            color = EvTheme.colors.inkSecondary,
        )
        if (lat != null && lng != null) {
            Spacer(Modifier.height(12.dp))
            StaticPinMap(lat, lng, Modifier.fillMaxWidth().height(180.dp).clip(RoundedCornerShape(EvRadius.lg)), contentDescription = l.address)
        }
    }
}

@Composable
private fun OwnerCard(l: ListingDetail) {
    val c = EvTheme.colors
    val owner = l.owner
    EvCard(Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.listing_owner), style = EvTheme.type.h3, modifier = Modifier.semantics { heading() })
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Avatar(l.agency?.logoUrl ?: owner?.avatarUrl, l.agency?.name ?: l.contactName, size = 52.dp)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(l.agency?.name ?: l.contactName, style = EvTheme.type.bodyStrong)
                if (owner != null) {
                    Text(stringResource(R.string.listing_member_since, Dates.date(owner.memberSince)), style = EvTheme.type.caption, color = c.muted)
                    Text(stringResource(R.string.listing_active_listings, owner.activeListings), style = EvTheme.type.caption, color = c.muted)
                }
                Text(l.contactPhoneMasked, style = EvTheme.type.label, color = c.inkSecondary)
            }
            if (l.isBusiness || l.agency != null) BusinessBadge()
        }
    }
}

@Composable
fun Stars(rating: Double, size: androidx.compose.ui.unit.Dp = 14.dp) {
    val c = EvTheme.colors
    Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        (1..5).forEach { i ->
            Icon(if (rating >= i - 0.25) EvIcons.StarFilled else EvIcons.Star, null, tint = if (rating >= i - 0.25) c.star else c.subtle, modifier = Modifier.size(size))
        }
    }
}

@Composable
private fun ReviewsPreview(l: ListingDetail, reviews: List<az.evtap.core.model.Review>, onAll: () -> Unit) {
    EvCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.listing_reviews), style = EvTheme.type.h3, modifier = Modifier.weight(1f).semantics { heading() })
            if (l.reviewsCount > 0) PillButton(stringResource(R.string.common_see_all), onAll, kind = PillKind.Ghost, size = PillSize.Small, trailingIcon = EvIcons.ArrowUpRight)
        }
        if (reviews.isEmpty()) {
            Text(stringResource(R.string.listing_no_reviews), style = EvTheme.type.body, color = EvTheme.colors.muted)
        } else {
            reviews.forEach { ReviewItem(it, Modifier.padding(top = 12.dp)) }
        }
    }
}

@Composable
fun ReviewItem(r: az.evtap.core.model.Review, modifier: Modifier = Modifier, onReply: (() -> Unit)? = null) {
    val c = EvTheme.colors
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Avatar(r.author.avatarUrl, r.author.name, size = 36.dp)
            Column(Modifier.weight(1f)) {
                Text(r.author.name, style = EvTheme.type.bodyStrong)
                Text(Dates.date(r.createdAt), style = EvTheme.type.caption, color = c.muted)
            }
            Stars(r.rating.toDouble(), 12.dp)
        }
        Text(r.comment, style = EvTheme.type.body, color = c.inkSecondary)
        r.hostReply?.let { reply ->
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(EvRadius.md)).background(c.surfaceSunken).padding(12.dp)) {
                Text(stringResource(R.string.listing_host_reply), style = EvTheme.type.label)
                Text(reply, style = EvTheme.type.body, color = c.inkSecondary)
            }
        }
        if (onReply != null && r.hostReply == null) {
            PillButton(stringResource(R.string.listing_reply), onReply, kind = PillKind.Secondary, size = PillSize.Small, icon = EvIcons.MessageSquare)
        }
    }
}

/** Sticky contact bar: call (black pill), WhatsApp, message; daily rent shows the nightly price + "Book". */
@Composable
private fun ContactBar(l: ListingDetail, vm: ListingViewModel, waText: String) {
    val navigator = LocalNavigator.current
    val context = LocalContext.current
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        if (l.dealType == DealType.RENT_DAILY && l.status == ListingStatus.ACTIVE) {
            Column(Modifier.weight(1f)) {
                PriceText(l.priceParts(), style = EvTheme.type.h3)
                l.minNights?.let { Text(stringResource(R.string.booking_min_nights, it), style = EvTheme.type.caption, color = EvTheme.colors.muted) }
            }
            IconCircleButton(EvIcons.Phone, stringResource(R.string.listing_call), { vm.withPhone { Intents.dial(context, it) } }, style = CircleStyle.Raised, size = 48.dp)
            IconCircleButton(EvIcons.MessageCircle, stringResource(R.string.listing_message), {
                navigator.requireAuth { navigator.open(NewChatRoute(l.id, l.title, l.contactName)) }
            }, style = CircleStyle.Raised, size = 48.dp)
            PillButton(stringResource(R.string.listing_book), { navigator.requireAuth { navigator.open(BookRoute(l.id)) } }, icon = EvIcons.CalendarDays)
        } else {
            PillButton(stringResource(R.string.listing_call), { vm.withPhone { Intents.dial(context, it) } }, Modifier.weight(1f), icon = EvIcons.Phone)
            IconCircleButton(EvIcons.MessageSquare, stringResource(R.string.listing_whatsapp), { vm.withPhone { Intents.whatsapp(context, it, waText) } }, style = CircleStyle.Raised, size = 48.dp)
            IconCircleButton(EvIcons.MessageCircle, stringResource(R.string.listing_message), {
                navigator.requireAuth { navigator.open(NewChatRoute(l.id, l.title, l.contactName)) }
            }, style = CircleStyle.Raised, size = 48.dp)
        }
    }
}
