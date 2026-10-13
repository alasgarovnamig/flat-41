package az.evtap.app.feature.search

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import az.evtap.app.R
import az.evtap.app.feature.main.TabBarClearance
import az.evtap.app.ui.common.Labels
import az.evtap.app.ui.common.LocalAppContainer
import az.evtap.app.ui.common.LocalAppLocale
import az.evtap.app.ui.common.appViewModel
import az.evtap.app.ui.common.asString
import az.evtap.app.ui.common.priceParts
import az.evtap.app.ui.components.ActionSheet
import az.evtap.app.ui.components.ChoiceChip
import az.evtap.app.ui.components.CircleStyle
import az.evtap.app.ui.components.CountBubble
import az.evtap.app.ui.components.EmptyState
import az.evtap.app.ui.components.ErrorState
import az.evtap.app.ui.components.EvBottomSheet
import az.evtap.app.ui.components.EvImage
import az.evtap.app.ui.components.EvTextField
import az.evtap.app.ui.components.FilterPill
import az.evtap.app.ui.components.IconCircleButton
import az.evtap.app.ui.components.ListingsMap
import az.evtap.app.ui.components.LoadingFooter
import az.evtap.app.ui.components.PillButton
import az.evtap.app.ui.components.PillKind
import az.evtap.app.ui.components.PillSize
import az.evtap.app.ui.components.PriceText
import az.evtap.app.ui.components.PropertyCard
import az.evtap.app.ui.components.PropertyCardSkeleton
import az.evtap.app.ui.components.SearchField
import az.evtap.app.ui.components.SheetAction
import az.evtap.app.ui.components.SwitchRow
import az.evtap.app.ui.components.glass
import az.evtap.app.ui.components.pressable
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.theme.EvRadius
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.format.Format
import az.evtap.core.model.DealType
import az.evtap.core.model.ListingSort
import az.evtap.core.model.MapPoint
import az.evtap.core.search.ListingFilters
import com.google.android.gms.maps.model.LatLng
import kotlinx.coroutines.launch

@Composable
fun SearchScreen() {
    val vm = appViewModel { SearchViewModel(it) }
    val filters by vm.filters.collectAsStateWithLifecycle()
    val query by vm.query.collectAsStateWithLifecycle()
    val mode by vm.mode.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    var filterOpen by rememberSaveable { mutableStateOf(false) }
    var sortOpen by rememberSaveable { mutableStateOf(false) }
    var saveOpen by rememberSaveable { mutableStateOf(false) }

    Column(Modifier.fillMaxSize()) {
        // ── Top: search pill + filter button + chips row
        Column(Modifier.statusBarsPadding().padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SearchField(query, vm::setQuery, stringResource(R.string.home_search_placeholder), Modifier.weight(1f))
                Box {
                    IconCircleButton(
                        EvIcons.Sliders,
                        stringResource(R.string.common_filters) + if (filters.activeCount > 0) ", ${filters.activeCount}" else "",
                        { filterOpen = true },
                        style = if (filters.activeCount > 0) CircleStyle.Ink else CircleStyle.Raised,
                        size = 48.dp,
                    )
                    if (filters.activeCount > 0) CountBubble(filters.activeCount, Modifier.align(Alignment.TopEnd))
                }
            }
            LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                item {
                    ChoiceChip(
                        stringResource(if (mode == SearchMode.LIST) R.string.search_map else R.string.search_list),
                        selected = false,
                        onClick = { vm.setMode(if (mode == SearchMode.LIST) SearchMode.MAP else SearchMode.LIST) },
                        icon = if (mode == SearchMode.LIST) EvIcons.Map else EvIcons.List,
                    )
                }
                items(DealType.entries) { d ->
                    ChoiceChip(stringResource(Labels.dealShort(d)), filters.dealType == d, {
                        vm.apply(filters.copy(dealType = if (filters.dealType == d) null else d))
                    })
                }
                item {
                    FilterPill(stringResource(Labels.sort(filters.sort)), { sortOpen = true }, icon = EvIcons.ArrowUpDown)
                }
            }
        }

        when (mode) {
            SearchMode.LIST -> ResultsList(vm, onSave = { navigator.requireAuth { saveOpen = true } }, onReset = { vm.apply(ListingFilters(q = filters.q)) })
            SearchMode.MAP -> MapMode(vm)
        }
    }

    if (filterOpen) FilterSheet(initial = filters, onDismiss = { filterOpen = false }, onApply = { vm.apply(it.copy(q = filters.q)) })
    if (sortOpen) {
        ActionSheet(
            title = stringResource(R.string.search_sort),
            actions = ListingSort.entries.map { s ->
                SheetAction(stringResource(Labels.sort(s)), selected = filters.sort == s) { vm.apply(filters.copy(sort = s)) }
            },
            onDismiss = { sortOpen = false },
        )
    }
    if (saveOpen) SaveSearchSheet(vm, defaultName = defaultSearchName(filters), onDismiss = { saveOpen = false })
}

@Composable
private fun ResultsList(vm: SearchViewModel, onSave: () -> Unit, onReset: () -> Unit) {
    val state by vm.pager.state.collectAsStateWithLifecycle()
    val navigator = LocalNavigator.current
    val container = LocalAppContainer.current
    val favorites by container.favorites.ids.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val list = rememberLazyListState()
    val nearEnd by remember { derivedStateOf { list.layoutInfo.visibleItemsInfo.lastOrNull()?.index?.let { it >= list.layoutInfo.totalItemsCount - 4 } ?: false } }
    LaunchedEffect(nearEnd) { if (nearEnd) vm.pager.loadMore() }

    PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = { vm.pager.refresh(userInitiated = true) }, modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            state = list,
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = TabBarClearance + 16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            state.total?.let { total ->
                item(key = "header") {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            stringResource(R.string.search_results, Format.groupThousands(total.toLong())),
                            style = EvTheme.type.label,
                            modifier = Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite },
                        )
                        PillButton(stringResource(R.string.search_save_search), onSave, kind = PillKind.Ghost, size = PillSize.Small, icon = EvIcons.Bookmark)
                    }
                }
            }
            if (state.isInitialLoading) {
                items(3, key = { "sk$it" }) { PropertyCardSkeleton() }
            }
            items(state.items, key = { it.id }) { l ->
                PropertyCard(l, l.id in favorites, { navigator.openListing(l.id) }, {
                    navigator.requireAuth { scope.launch { runCatching { container.favorites.toggle(l.id) }.onFailure { container.toaster.error(it) } } }
                })
            }
            when {
                state.error != null -> item(key = "error") { ErrorState(state.error!!, onRetry = { vm.pager.retry() }) }
                state.isEmpty -> item(key = "empty") {
                    EmptyState(
                        EvIcons.Search,
                        stringResource(R.string.search_no_results),
                        body = stringResource(R.string.search_no_results_hint),
                        actionLabel = stringResource(R.string.common_reset),
                        onAction = onReset,
                    )
                }
                state.loading && state.items.isNotEmpty() -> item(key = "more") { LoadingFooter() }
            }
        }
    }
}

@Composable
private fun MapMode(vm: SearchViewModel) {
    val map by vm.map.collectAsStateWithLifecycle()
    val filters by vm.filters.collectAsStateWithLifecycle()
    val container = LocalAppContainer.current
    val navigator = LocalNavigator.current
    val city = container.locations.city(filters.cityId ?: "baku") ?: container.locations.city("baku")
    val center = remember(city?.id) { LatLng(city?.lat ?: 40.4093, city?.lng ?: 49.8671) }
    Box(Modifier.fillMaxSize().padding(top = 12.dp)) {
        ListingsMap(
            markers = map.markers,
            center = center,
            selectedId = map.selectedId,
            onViewport = vm::onViewport,
            onSelect = vm::select,
            modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(topStart = EvRadius.xl, topEnd = EvRadius.xl)),
        )
        Row(Modifier.align(Alignment.TopCenter).padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (map.loading) {
                Box(Modifier.size(36.dp).glass(RoundedCornerShape(50)), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(Modifier.size(18.dp), color = EvTheme.colors.ink, strokeWidth = 2.dp)
                }
            }
            if (map.limitReached) {
                Box(Modifier.glass(RoundedCornerShape(50)).padding(horizontal = 14.dp, vertical = 8.dp)) {
                    Text(stringResource(R.string.search_map_limit), style = EvTheme.type.caption)
                }
            }
            map.error?.let { err ->
                Box(Modifier.glass(RoundedCornerShape(50)).padding(horizontal = 14.dp, vertical = 8.dp)) {
                    Text(err.asString(), style = EvTheme.type.caption, color = EvTheme.colors.danger)
                }
            }
        }
        map.selected?.let { p ->
            MapPointCard(
                p,
                onClick = { navigator.openListing(p.id) },
                modifier = Modifier.align(Alignment.BottomCenter).padding(start = 16.dp, end = 16.dp, bottom = TabBarClearance),
            )
        }
    }
}

@Composable
private fun MapPointCard(p: MapPoint, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = EvTheme.colors
    Row(
        modifier.fillMaxWidth().glass(RoundedCornerShape(EvRadius.lg)).pressable(onClick).padding(10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        EvImage(p.coverUrl, null, Modifier.size(76.dp).clip(RoundedCornerShape(EvRadius.md)))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(p.title, style = EvTheme.type.bodyStrong, maxLines = 2)
            PriceText(priceParts(p.price, p.currency.symbol, p.pricePeriod))
        }
        Box(Modifier.size(36.dp).clip(RoundedCornerShape(50)).background(c.ink), contentAlignment = Alignment.Center) {
            androidx.compose.material3.Icon(EvIcons.ArrowUpRight, null, tint = c.onInk, modifier = Modifier.size(18.dp))
        }
    }
}

@Composable
private fun SaveSearchSheet(vm: SearchViewModel, defaultName: String, onDismiss: () -> Unit) {
    var name by rememberSaveable { mutableStateOf(defaultName) }
    var notify by rememberSaveable { mutableStateOf(true) }
    val saving by vm.saving.collectAsStateWithLifecycle()
    EvBottomSheet(onDismiss = onDismiss, title = stringResource(R.string.search_save_search)) {
        EvTextField(name, { name = it }, stringResource(R.string.search_save_search_name), maxLength = 80)
        SwitchRow(stringResource(R.string.search_save_search_notify), notify, { notify = it })
        PillButton(
            stringResource(R.string.common_save),
            { vm.saveSearch(name, notify, onDismiss) },
            Modifier.fillMaxWidth(),
            enabled = name.isNotBlank(),
            loading = saving,
        )
    }
}

/** "Satış, Bakı, ≤ 150 000 ₼" — prefilled saved-search name. */
@Composable
private fun defaultSearchName(f: ListingFilters): String {
    val container = LocalAppContainer.current
    val locale = LocalAppLocale.current
    val parts = listOfNotNull(
        f.dealType?.let { stringResource(Labels.deal(it)) },
        f.cityId?.let { container.locations.city(it)?.name?.get(locale) },
        f.priceMax?.let { "≤ " + Format.price(it, f.currency ?: az.evtap.core.model.Currency.AZN) },
        f.q,
    )
    return parts.joinToString(", ").ifBlank { stringResource(R.string.search_title) }.take(80)
}
