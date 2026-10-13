package az.evtap.app.feature.mylistings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import az.evtap.app.AppContainer
import az.evtap.app.R
import az.evtap.app.data.SessionState
import az.evtap.app.ui.common.Dates
import az.evtap.app.ui.common.Labels
import az.evtap.app.ui.common.LocalAppContainer
import az.evtap.app.ui.common.Load
import az.evtap.app.ui.common.Pager
import az.evtap.app.ui.common.appViewModel
import az.evtap.app.ui.common.loadInto
import az.evtap.app.ui.components.ActionSheet
import az.evtap.app.ui.components.BarcodeSpark
import az.evtap.app.ui.components.ChoiceChip
import az.evtap.app.ui.components.CircleStyle
import az.evtap.app.ui.components.ConfirmDialog
import az.evtap.app.ui.components.EmptyState
import az.evtap.app.ui.components.ErrorState
import az.evtap.app.ui.components.EvCard
import az.evtap.app.ui.components.EvScreen
import az.evtap.app.ui.components.EvTopBar
import az.evtap.app.ui.components.IconCircleButton
import az.evtap.app.ui.components.LoadingBox
import az.evtap.app.ui.components.LoadingFooter
import az.evtap.app.ui.components.MetricTile
import az.evtap.app.ui.components.NoticeBanner
import az.evtap.app.ui.components.NoticeTone
import az.evtap.app.ui.components.PillBar
import az.evtap.app.ui.components.PillBarChart
import az.evtap.app.ui.components.PropertyRow
import az.evtap.app.ui.components.SheetAction
import az.evtap.app.ui.components.SplitMeter
import az.evtap.app.ui.components.StatCard
import az.evtap.app.ui.components.StatusTag
import az.evtap.app.ui.components.deltaPercent
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.navigation.HostCalendarRoute
import az.evtap.app.ui.navigation.ListingFeeRoute
import az.evtap.app.ui.navigation.ListingStatsRoute
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.navigation.PostRoute
import az.evtap.app.ui.navigation.PromoteRoute
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.format.Format
import az.evtap.core.model.ApplyCreditInput
import az.evtap.core.model.CreditType
import az.evtap.core.model.DealType
import az.evtap.core.model.ListingAction
import az.evtap.core.model.ListingActionInput
import az.evtap.core.model.ListingStats
import az.evtap.core.model.ListingStatus
import az.evtap.core.model.MyListing
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

private val TABS = listOf(ListingStatus.ACTIVE, ListingStatus.PENDING, ListingStatus.DRAFT, ListingStatus.REJECTED, ListingStatus.EXPIRED, ListingStatus.ARCHIVED)

class MyListingsViewModel(private val c: AppContainer) : ViewModel() {
    private val _status = MutableStateFlow(ListingStatus.ACTIVE)
    val status: StateFlow<ListingStatus> = _status.asStateFlow()
    val pager = Pager<MyListing>(viewModelScope) { page, size -> c.api.call { myListings(_status.value, page, size) } }

    init {
        pager.refresh()
    }

    fun setStatus(s: ListingStatus) {
        _status.value = s
        pager.refresh()
    }

    fun action(l: MyListing, a: ListingAction) {
        viewModelScope.launch {
            try {
                val updated = c.api.call { listingAction(l.id, ListingActionInput(a)) }
                pager.update { list -> if (updated.status == _status.value) list.map { if (it.id == l.id) updated else it } else list.filterNot { it.id == l.id } }
                c.toaster.success(R.string.my_listings_done)
            } catch (e: Exception) {
                c.toaster.error(e)
            }
        }
    }

    fun delete(l: MyListing) {
        viewModelScope.launch {
            try {
                c.api.call { deleteListing(l.id) }
                pager.update { list -> list.filterNot { it.id == l.id } }
                c.toaster.success(R.string.my_listings_done)
            } catch (e: Exception) {
                c.toaster.error(e)
            }
        }
    }

    fun applyCredit(l: MyListing, credit: CreditType) {
        viewModelScope.launch {
            try {
                val updated = c.api.call { applyCredit(l.id, ApplyCreditInput(credit)) }
                pager.update { list -> list.map { if (it.id == l.id) updated else it } }
                c.session.refreshMe()
                c.toaster.success(R.string.promote_credit_applied)
            } catch (e: Exception) {
                c.toaster.error(e)
            }
        }
    }
}

@Composable
fun MyListingsScreen() {
    val navigator = LocalNavigator.current
    val container = LocalAppContainer.current
    val vm = appViewModel { MyListingsViewModel(it) }
    val status by vm.status.collectAsStateWithLifecycle()
    val state by vm.pager.state.collectAsStateWithLifecycle()
    val session by container.session.state.collectAsStateWithLifecycle()
    val me = (session as? SessionState.Authed)?.me
    var menuFor by remember { mutableStateOf<MyListing?>(null) }
    var confirm by remember { mutableStateOf<Pair<MyListing, ListingAction?>?>(null) }
    val list = rememberLazyListState()
    val nearEnd by remember { derivedStateOf { (list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= list.layoutInfo.totalItemsCount - 3 } }
    LaunchedEffect(nearEnd) { if (nearEnd) vm.pager.loadMore() }
    val c = EvTheme.colors

    EvScreen(
        topBar = {
            EvTopBar(stringResource(R.string.my_listings_title), navigator::back, large = true) {
                IconCircleButton(EvIcons.Plus, stringResource(R.string.my_listings_new_listing), { navigator.open(PostRoute()) }, style = CircleStyle.Ink)
            }
        },
    ) { padding ->
        PullToRefreshBox(state.refreshing, { vm.pager.refresh(userInitiated = true) }, Modifier.fillMaxSize().padding(top = padding.calculateTopPadding())) {
            LazyColumn(
                state = list,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = padding.calculateBottomPadding() + 24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                // Summary: total views of the loaded listings + quota.
                if (status == ListingStatus.ACTIVE && state.items.isNotEmpty()) {
                    item(key = "summary") {
                        val views = state.items.sumOf { it.views }
                        val calls = state.items.sumOf { it.phoneViews }
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            StatCard(
                                stringResource(R.string.my_listings_views),
                                AnnotatedString(Format.groupThousands(views)),
                                stringResource(R.string.my_listings_stats_title),
                                Modifier.weight(1f),
                                spark = state.items.map { it.views.toFloat() },
                            )
                            StatCard(
                                stringResource(R.string.my_listings_phone_views),
                                AnnotatedString(Format.groupThousands(calls)),
                                me?.quota?.let { q -> if (q.unlimited) stringResource(R.string.post_quota_unlimited) else stringResource(R.string.profile_quota, q.remaining, q.freeLimit) },
                                Modifier.weight(1f),
                            )
                        }
                    }
                }
                item(key = "tabs") {
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(TABS) { s ->
                            ChoiceChip(stringResource(tabLabel(s)), status == s, { vm.setStatus(s) })
                        }
                    }
                }
                if (state.isInitialLoading) item { LoadingBox() }
                items(state.items, key = { it.id }) { l ->
                    MyListingItem(l, onOpen = { navigator.openListing(l.id) }, onMenu = { menuFor = l })
                }
                state.error?.let { item { ErrorState(it, vm.pager::retry) } }
                if (state.isEmpty) {
                    item {
                        EmptyState(EvIcons.LayoutList, stringResource(R.string.my_listings_empty), actionLabel = stringResource(R.string.my_listings_new_listing), onAction = { navigator.open(PostRoute()) })
                    }
                }
                if (state.loading && state.items.isNotEmpty()) item { LoadingFooter() }
            }
        }
    }

    menuFor?.let { l ->
        val credits = me?.activeSubscription?.usage
        val actions = buildList {
            add(SheetAction(stringResource(R.string.my_listings_view)) { navigator.openListing(l.id) })
            add(SheetAction(stringResource(R.string.common_edit)) { navigator.open(PostRoute(l.id)) })
            if (l.status == ListingStatus.ACTIVE) {
                add(SheetAction(stringResource(R.string.promote_title)) { navigator.open(PromoteRoute(l.id)) })
                add(SheetAction(stringResource(R.string.my_listings_stats)) { navigator.open(ListingStatsRoute(l.id)) })
                if (credits != null && credits.bumpsLeft > 0) add(SheetAction(stringResource(R.string.my_listings_apply_credit) + " · " + stringResource(Labels.credit(CreditType.BUMP))) { vm.applyCredit(l, CreditType.BUMP) })
                if (credits != null && credits.vipCreditsLeft > 0) add(SheetAction(stringResource(R.string.my_listings_apply_credit) + " · " + stringResource(Labels.credit(CreditType.VIP_7))) { vm.applyCredit(l, CreditType.VIP_7) })
                if (credits != null && credits.premiumCreditsLeft > 0) add(SheetAction(stringResource(R.string.my_listings_apply_credit) + " · " + stringResource(Labels.credit(CreditType.PREMIUM_7))) { vm.applyCredit(l, CreditType.PREMIUM_7) })
                add(SheetAction(stringResource(R.string.my_listings_mark_sold)) { confirm = l to ListingAction.MARK_SOLD })
                add(SheetAction(stringResource(R.string.my_listings_archive)) { confirm = l to ListingAction.ARCHIVE })
            }
            if (l.dealType == DealType.RENT_DAILY) add(SheetAction(stringResource(R.string.my_listings_calendar)) { navigator.open(HostCalendarRoute(l.id)) })
            if (l.status == ListingStatus.DRAFT && l.requiresPayment) add(SheetAction(stringResource(R.string.my_listings_pay_fee)) { navigator.open(ListingFeeRoute(l.id)) })
            if (l.status == ListingStatus.EXPIRED) add(SheetAction(stringResource(R.string.my_listings_renew)) { vm.action(l, ListingAction.RENEW) })
            if (l.status == ListingStatus.ARCHIVED || l.status == ListingStatus.SOLD) add(SheetAction(stringResource(R.string.my_listings_restore)) { vm.action(l, ListingAction.RESTORE) })
            if (l.status != ListingStatus.ARCHIVED) add(SheetAction(stringResource(R.string.common_delete), destructive = true) { confirm = l to null })
        }
        ActionSheet(l.title, actions, onDismiss = { menuFor = null })
    }
    confirm?.let { (l, action) ->
        ConfirmDialog(
            title = l.title,
            text = stringResource(
                when (action) {
                    ListingAction.MARK_SOLD -> R.string.my_listings_confirm_sold
                    else -> R.string.my_listings_confirm_archive
                },
            ),
            confirmLabel = stringResource(
                when (action) {
                    ListingAction.MARK_SOLD -> R.string.my_listings_mark_sold
                    ListingAction.ARCHIVE -> R.string.my_listings_archive
                    else -> R.string.common_delete
                },
            ),
            destructive = action != ListingAction.MARK_SOLD,
            onConfirm = { if (action == null) vm.delete(l) else vm.action(l, action) },
            onDismiss = { confirm = null },
        )
    }
}

private fun tabLabel(s: ListingStatus) = when (s) {
    ListingStatus.ACTIVE -> R.string.my_listings_tabs_active
    ListingStatus.PENDING -> R.string.my_listings_tabs_pending
    ListingStatus.DRAFT -> R.string.my_listings_tabs_draft
    ListingStatus.REJECTED -> R.string.my_listings_tabs_rejected
    ListingStatus.EXPIRED -> R.string.my_listings_tabs_expired
    else -> R.string.my_listings_tabs_archived
}

@Composable
private fun MyListingItem(l: MyListing, onOpen: () -> Unit, onMenu: () -> Unit) {
    val c = EvTheme.colors
    EvCard(Modifier.fillMaxWidth(), contentPadding = PaddingValues(12.dp)) {
        PropertyRow(l, onOpen, thumb = 80.dp, trailing = {
            IconCircleButton(EvIcons.MoreVertical, stringResource(R.string.my_listings_actions), onMenu, style = CircleStyle.Transparent)
        })
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            StatusTag(l.status)
            Text("${stringResource(R.string.my_listings_views)} ${l.views}", style = EvTheme.type.caption, color = c.inkSecondary)
            Text("${stringResource(R.string.my_listings_phone_views)} ${l.phoneViews}", style = EvTheme.type.caption, color = c.inkSecondary)
            Text("${stringResource(R.string.my_listings_favorites)} ${l.favoritesCount}", style = EvTheme.type.caption, color = c.inkSecondary)
        }
        l.expiresAt?.let { Text(stringResource(R.string.my_listings_expires, Dates.date(it)), style = EvTheme.type.caption, color = c.muted, modifier = Modifier.padding(top = 4.dp)) }
        l.rejectionReason?.let { NoticeBanner(stringResource(R.string.my_listings_rejected, it), Modifier.padding(top = 8.dp), tone = NoticeTone.Danger) }
        if (l.requiresPayment) NoticeBanner(stringResource(R.string.my_listings_waiting_payment), Modifier.padding(top = 8.dp), tone = NoticeTone.Warning)
    }
}

// ───────────────────────────── Listing statistics ─────────────────────────────

class ListingStatsViewModel(private val id: String, private val c: AppContainer) : ViewModel() {
    val stats = MutableStateFlow<Load<ListingStats>>(Load.Loading)
    init {
        load()
    }
    fun load() = loadInto(stats) { c.api.call { listingStats(id) } }
}

@Composable
fun ListingStatsScreen(id: String) {
    val navigator = LocalNavigator.current
    val vm = appViewModel(key = "stats-$id") { ListingStatsViewModel(id, it) }
    val load by vm.stats.collectAsStateWithLifecycle()
    EvScreen(topBar = { EvTopBar(stringResource(R.string.my_listings_stats), navigator::back, large = true, subtitle = stringResource(R.string.my_listings_stats_title)) }) { padding ->
        when (val s = load) {
            Load.Loading -> LoadingBox(Modifier.padding(padding))
            is Load.Failed -> ErrorState(s.error, vm::load, Modifier.padding(padding))
            is Load.Ready -> StatsContent(s.data, Modifier.padding(padding))
        }
    }
}

@Composable
private fun StatsContent(s: ListingStats, modifier: Modifier) {
    val views = s.daily.map { it.views.toFloat() }
    val calls = s.daily.map { it.phoneViews.toFloat() }
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        StatCard(
            stringResource(R.string.my_listings_views),
            AnnotatedString(Format.groupThousands(s.views)),
            stringResource(R.string.my_listings_stats_title),
            Modifier.fillMaxWidth(),
            spark = views,
            tag = deltaPercent(views),
        )
        EvCard(Modifier.fillMaxWidth()) {
            val total = (s.views + s.phoneViews).coerceAtLeast(1)
            SplitMeter(
                leftLabel = stringResource(R.string.my_listings_views),
                leftValue = AnnotatedString(Format.groupThousands(s.views)),
                rightLabel = stringResource(R.string.my_listings_phone_views),
                rightValue = AnnotatedString(Format.groupThousands(s.phoneViews)),
                leftFraction = s.views.toFloat() / total,
                rightFraction = s.phoneViews.toFloat() / total,
            )
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            MetricTile(stringResource(R.string.my_listings_favorites), Format.groupThousands(s.favorites), Modifier.weight(1f))
            MetricTile(stringResource(R.string.my_listings_messages), Format.groupThousands(s.messages), Modifier.weight(1f))
        }
        // Last 7 days as pill bars with the per-day change tag.
        val last = s.daily.takeLast(7)
        if (last.isNotEmpty()) {
            EvCard(Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.my_listings_views), style = EvTheme.type.h3)
                Spacer(Modifier.height(12.dp))
                val maxV = (last.maxOf { it.views }.coerceAtLeast(1)).toFloat()
                PillBarChart(
                    bars = last.mapIndexed { i, d ->
                        val prev = last.getOrNull(i - 1)?.views
                        val tag = prev?.takeIf { it > 0 }?.let { p -> val pct = ((d.views - p) * 100 / p).toInt(); if (pct >= 0) "+$pct%" else "−${-pct}%" }
                        PillBar("${Dates.dayMonth(java.time.LocalDate.parse(d.date.take(10)))} · ${d.views}", d.views.toFloat(), tag)
                    },
                    max = maxV,
                    axis = listOf("0", Format.groupThousands((maxV / 2).toLong()), Format.groupThousands(maxV.toLong())),
                    description = stringResource(R.string.my_listings_stats_title),
                )
            }
        }
        EvCard(Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.my_listings_phone_views), style = EvTheme.type.h3)
            Spacer(Modifier.height(10.dp))
            BarcodeSpark(calls, highlight = 7, height = 44.dp, description = stringResource(R.string.my_listings_phone_views) + " " + s.phoneViews)
        }
        Spacer(Modifier.height(16.dp))
    }
}
