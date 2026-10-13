package az.evtap.app.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import az.evtap.app.AppContainer
import az.evtap.app.R
import az.evtap.app.data.SessionState
import az.evtap.app.feature.main.TabBarClearance
import az.evtap.app.platform.Intents
import az.evtap.app.ui.common.Labels
import az.evtap.app.ui.common.LocalAppContainer
import az.evtap.app.ui.common.LocalAppLocale
import az.evtap.app.ui.common.Load
import az.evtap.app.ui.common.appViewModel
import az.evtap.app.ui.components.ChoiceChip
import az.evtap.app.ui.components.CircleStyle
import az.evtap.app.ui.components.EvCard
import az.evtap.app.ui.components.EvImage
import az.evtap.app.ui.components.IconCircleButton
import az.evtap.app.ui.components.PropertyCard
import az.evtap.app.ui.components.PropertyCardSkeleton
import az.evtap.app.ui.components.CarouselPropertyCard
import az.evtap.app.ui.components.SearchField
import az.evtap.app.ui.components.SectionHeader
import az.evtap.app.ui.components.SplitMeter
import az.evtap.app.ui.components.pressable
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.navigation.FavoritesRoute
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.navigation.NotificationsRoute
import az.evtap.app.ui.navigation.PostRoute
import az.evtap.app.ui.theme.EvRadius
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.format.Format
import az.evtap.core.model.Banner
import az.evtap.core.model.BannerPlacement
import az.evtap.core.model.DealType
import az.evtap.core.model.ListingCard
import az.evtap.core.model.Paginated
import az.evtap.core.search.ListingFilters
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class HomeCounts(val sale: Int, val rentLong: Int, val daily: Int)

data class HomeState(
    val premium: Load<List<ListingCard>> = Load.Loading,
    val vip: Load<List<ListingCard>> = Load.Loading,
    val latest: Load<List<ListingCard>> = Load.Loading,
    val banners: List<Banner> = emptyList(),
    val counts: HomeCounts? = null,
    val refreshing: Boolean = false,
)

class HomeViewModel(private val c: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(HomeState())
    val state: StateFlow<HomeState> = _state.asStateFlow()

    init {
        load(false)
    }

    fun load(userRefresh: Boolean) {
        if (userRefresh) _state.value = _state.value.copy(refreshing = true)
        viewModelScope.launch {
            val premium = async { runCatching { c.api.call { featured("premium", limit = 12) } } }
            val vip = async { runCatching { c.api.call { featured("vip", limit = 6) } } }
            val latest = async { runCatching { c.api.call { listings(ListingFilters().toPageQuery(1, 10)) }.items } }
            val banners = async { runCatching { c.api.call { banners(BannerPlacement.MOBILE_HOME) } }.getOrDefault(emptyList()) }
            val counts = async {
                runCatching {
                    suspend fun count(d: DealType): Int =
                        c.api.call<Paginated<ListingCard>> { listings(ListingFilters(dealType = d).toPageQuery(1, 1)) }.total
                    HomeCounts(count(DealType.SALE), count(DealType.RENT_LONG), count(DealType.RENT_DAILY))
                }.getOrNull()
            }
            fun <T> Result<T>.toLoad(): Load<T> = fold({ Load.Ready(it) }, { Load.Failed(az.evtap.app.ui.common.UiText.error(it)) })
            _state.value = HomeState(
                premium = premium.await().toLoad(),
                vip = vip.await().toLoad(),
                latest = latest.await().toLoad(),
                banners = banners.await(),
                counts = counts.await(),
                refreshing = false,
            )
        }
    }

    fun bannerClicked(b: Banner) {
        viewModelScope.launch { runCatching { c.api.call { bannerClick(b.id) } } }
    }
}

@Composable
fun HomeScreen() {
    val vm = appViewModel { HomeViewModel(it) }
    val state by vm.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val container = LocalAppContainer.current
    val favorites by container.favorites.ids.collectAsStateWithLifecycle()
    val session by container.session.state.collectAsStateWithLifecycle()
    val me = (session as? SessionState.Authed)?.me
    val context = LocalContext.current
    val c = EvTheme.colors
    val dark = EvTheme.isDark
    var query by rememberSaveable { mutableStateOf("") }
    val scope = androidx.compose.runtime.rememberCoroutineScope()
    val toggleFav: (String) -> Unit = { id ->
        navigator.requireAuth { scope.launch { runCatching { container.favorites.toggle(id) }.onFailure { container.toaster.error(it) } } }
    }

    PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = { vm.load(true) }, modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = TabBarClearance + 16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            item(key = "header") {
                Row(
                    Modifier.fillMaxWidth().statusBarsPadding().padding(start = 20.dp, end = 12.dp, top = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Logo()
                    Spacer(Modifier.width(10.dp))
                    Text("EvTap", style = EvTheme.type.h3, modifier = Modifier.weight(1f))
                    IconCircleButton(EvIcons.Heart, stringResource(R.string.favorites_title), { navigator.requireAuth { navigator.open(FavoritesRoute) } }, style = CircleStyle.Raised)
                    IconCircleButton(
                        EvIcons.Bell,
                        stringResource(R.string.notifications_title),
                        { navigator.requireAuth { navigator.open(NotificationsRoute) } },
                        style = CircleStyle.Raised,
                        badge = (me?.unreadNotifications ?: 0) > 0,
                    )
                }
            }
            item(key = "hero") {
                Column(Modifier.padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Text(stringResource(R.string.home_headline), style = EvTheme.type.display, modifier = Modifier.semantics { heading() })
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SearchField(
                            value = query,
                            onValueChange = { query = it },
                            placeholder = stringResource(R.string.home_search_placeholder),
                            modifier = Modifier.weight(1f),
                            onSubmit = { navigator.search(ListingFilters(q = query.trim().ifEmpty { null })) },
                        )
                        IconCircleButton(EvIcons.Sliders, stringResource(R.string.common_filters), { navigator.search(ListingFilters(q = query.trim().ifEmpty { null })) }, style = CircleStyle.Ink, size = 48.dp)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        DealType.entries.forEach { d ->
                            ChoiceChip(
                                stringResource(Labels.dealShort(d)),
                                selected = false,
                                onClick = { navigator.search(ListingFilters(dealType = d)) },
                                icon = when (d) { DealType.SALE -> EvIcons.Tag; DealType.RENT_LONG -> EvIcons.Key; DealType.RENT_DAILY -> EvIcons.CalendarDays },
                                onCanvas = false,
                            )
                        }
                    }
                }
            }
            state.counts?.let { counts ->
                item(key = "stats") { MarketStrip(counts) { navigator.search(ListingFilters(dealType = it)) } }
            }
            if (state.banners.isNotEmpty()) {
                item(key = "banners") {
                    BannerPager(state.banners) { b ->
                        vm.bannerClicked(b)
                        val web = container.webUrl
                        val link = az.evtap.core.deeplink.DeepLinkParser.parse(b.linkUrl)
                        // In-app routes (evtap://… or our own web URLs) open natively; anything else in a Custom Tab.
                        if (link != null && (b.linkUrl.startsWith(web) || b.linkUrl.startsWith("evtap:"))) navigator.handle(link, context)
                        else if (b.linkUrl.isNotBlank()) Intents.customTab(context, b.linkUrl, c.canvas.toArgb(), dark)
                    }
                }
            }
            item(key = "premium") {
                Column {
                    SectionHeader(stringResource(R.string.home_premium), Modifier.padding(horizontal = 20.dp))
                    when (val p = state.premium) {
                        is Load.Ready -> if (p.data.isEmpty()) {
                            PostPromo(Modifier.padding(horizontal = 20.dp)) { navigator.requireAuth { navigator.open(PostRoute()) } }
                        } else {
                            LazyRow(contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                                items(p.data, key = { it.id }) { l ->
                                    CarouselPropertyCard(l, l.id in favorites, { navigator.openListing(l.id) }, { toggleFav(l.id) })
                                }
                            }
                        }
                        else -> Row(Modifier.padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                            PropertyCardSkeleton(Modifier.width(260.dp))
                            PropertyCardSkeleton(Modifier.width(260.dp))
                        }
                    }
                }
            }
            val vip = state.vip
            if (vip !is Load.Ready || vip.data.isNotEmpty()) {
                item(key = "vip-header") {
                    SectionHeader(stringResource(R.string.home_vip), Modifier.padding(horizontal = 20.dp), stringResource(R.string.common_see_all)) {
                        navigator.search(ListingFilters())
                    }
                }
                listingItems(vip, favorites, "vip", { navigator.openListing(it) }, toggleFav)
            }
            item(key = "daily") {
                DailyPromo(Modifier.padding(horizontal = 20.dp)) { navigator.search(ListingFilters(dealType = DealType.RENT_DAILY)) }
            }
            item(key = "cities") {
                Column(Modifier.padding(horizontal = 20.dp)) {
                    SectionHeader(stringResource(R.string.home_popular_cities))
                    val locale = LocalAppLocale.current
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        container.locations.popularCities.forEach { city ->
                            ChoiceChip(city.name.get(locale), false, { navigator.search(ListingFilters(cityId = city.id)) }, icon = EvIcons.MapPin, onCanvas = false)
                        }
                    }
                }
            }
            item(key = "latest-header") {
                SectionHeader(stringResource(R.string.home_latest), Modifier.padding(horizontal = 20.dp), stringResource(R.string.common_see_all)) {
                    navigator.search(ListingFilters())
                }
            }
            listingItems(state.latest, favorites, "latest", { navigator.openListing(it) }, toggleFav)
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.listingItems(
    load: Load<List<ListingCard>>,
    favorites: Set<String>,
    prefix: String,
    onOpen: (String) -> Unit,
    onFav: (String) -> Unit,
) {
    when (load) {
        is Load.Ready -> items(load.data, key = { "$prefix-${it.id}" }) { l ->
            PropertyCard(l, l.id in favorites, { onOpen(l.id) }, { onFav(l.id) }, Modifier.padding(horizontal = 20.dp))
        }
        is Load.Failed -> item(key = "$prefix-error") {
            az.evtap.app.ui.components.ErrorState(load.error, onRetry = null)
        }
        Load.Loading -> items(2, key = { "$prefix-skeleton-$it" }) { PropertyCardSkeleton(Modifier.padding(horizontal = 20.dp)) }
    }
}

@Composable
private fun Logo() {
    val c = EvTheme.colors
    Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(c.ink), contentAlignment = Alignment.Center) {
        Icon(EvIcons.Home, null, tint = c.onInk, modifier = Modifier.size(22.dp))
    }
}

/** Market split: Sale vs Rent (long + daily) as the reference "Apartments sold / rented" meter. */
@Composable
private fun MarketStrip(counts: HomeCounts, onDeal: (DealType) -> Unit) {
    val c = EvTheme.colors
    val total = (counts.sale + counts.rentLong + counts.daily).coerceAtLeast(1)
    fun big(n: Int) = androidx.compose.ui.text.AnnotatedString(Format.groupThousands(n.toLong()))
    EvCard(Modifier.padding(horizontal = 20.dp).fillMaxWidth()) {
        SplitMeter(
            leftLabel = stringResource(R.string.home_stat_sale),
            leftValue = big(counts.sale),
            rightLabel = stringResource(R.string.home_stat_rent),
            rightValue = big(counts.rentLong + counts.daily),
            leftFraction = counts.sale.toFloat() / total,
            rightFraction = (counts.rentLong + counts.daily).toFloat() / total,
        )
        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            ChoiceChip(stringResource(Labels.dealShort(DealType.SALE)), false, { onDeal(DealType.SALE) }, onCanvas = false)
            ChoiceChip(stringResource(Labels.dealShort(DealType.RENT_LONG)), false, { onDeal(DealType.RENT_LONG) }, onCanvas = false)
            ChoiceChip(
                stringResource(R.string.home_stat_daily, Format.groupThousands(counts.daily.toLong())),
                false,
                { onDeal(DealType.RENT_DAILY) },
                onCanvas = false,
            )
        }
    }
}

@Composable
private fun BannerPager(banners: List<Banner>, onClick: (Banner) -> Unit) {
    val pager = rememberPagerState { banners.size }
    HorizontalPager(pager, contentPadding = PaddingValues(horizontal = 20.dp), pageSpacing = 10.dp, key = { banners[it].id }) { page ->
        val b = banners[page]
        EvImage(
            b.imageUrl,
            b.title,
            Modifier
                .fillMaxWidth()
                .aspectRatio(2.4f)
                .clip(RoundedCornerShape(EvRadius.lg))
                .pressable({ onClick(b) }, role = Role.Button, onClickLabel = b.title),
        )
    }
}

@Composable
private fun DailyPromo(modifier: Modifier, onClick: () -> Unit) {
    val c = EvTheme.colors
    EvCard(modifier.fillMaxWidth(), color = c.highlightBg, onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Box(Modifier.size(52.dp).clip(RoundedCornerShape(16.dp)).background(c.accent), contentAlignment = Alignment.Center) {
                Icon(EvIcons.Sun, null, tint = c.onAccent, modifier = Modifier.size(26.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.home_daily_promo_title), style = EvTheme.type.h3)
                Text(stringResource(R.string.home_daily_promo_text), style = EvTheme.type.caption, color = c.inkSecondary)
            }
            Icon(EvIcons.ArrowUpRight, null, tint = c.ink)
        }
    }
}

@Composable
private fun PostPromo(modifier: Modifier, onClick: () -> Unit) {
    val c = EvTheme.colors
    EvCard(modifier.fillMaxWidth(), onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Box(Modifier.size(52.dp).clip(RoundedCornerShape(16.dp)).background(c.ink), contentAlignment = Alignment.Center) {
                Icon(EvIcons.HousePlus, null, tint = c.onInk, modifier = Modifier.size(26.dp))
            }
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.home_post_promo_title), style = EvTheme.type.h3)
                Text(stringResource(R.string.home_post_promo_text), style = EvTheme.type.caption, color = c.inkSecondary)
            }
        }
    }
}
