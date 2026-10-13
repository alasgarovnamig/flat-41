package az.evtap.app.feature.notifications

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import az.evtap.app.AppContainer
import az.evtap.app.R
import az.evtap.app.ui.common.Pager
import az.evtap.app.ui.common.appViewModel
import az.evtap.app.ui.common.relativeTime
import az.evtap.app.ui.components.EmptyState
import az.evtap.app.ui.components.ErrorState
import az.evtap.app.ui.components.EvCard
import az.evtap.app.ui.components.EvScreen
import az.evtap.app.ui.components.EvTopBar
import az.evtap.app.ui.components.LoadingBox
import az.evtap.app.ui.components.LoadingFooter
import az.evtap.app.ui.components.PillButton
import az.evtap.app.ui.components.PillKind
import az.evtap.app.ui.components.PillSize
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.deeplink.DeepLinkParser
import az.evtap.core.model.AppNotification
import az.evtap.core.model.NotificationType
import az.evtap.core.realtime.RealtimeEvent
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.coroutines.launch

class NotificationsViewModel(private val c: AppContainer) : ViewModel() {
    val pager = Pager<AppNotification>(viewModelScope, pageSize = 30) { page, size -> c.api.call { notifications(page, size) } }

    init {
        pager.refresh()
        viewModelScope.launch { c.realtime.events.collect { if (it is RealtimeEvent.NotificationNew) pager.refresh() } }
    }

    fun open(n: AppNotification) {
        if (n.readAt == null) {
            pager.update { list -> list.map { if (it.id == n.id) it.copy(readAt = java.time.Instant.now().toString()) else it } }
            viewModelScope.launch {
                runCatching { c.api.call { readNotification(n.id) } }
                c.session.refreshMe()
            }
        }
    }

    fun readAll() {
        viewModelScope.launch {
            try {
                c.api.call { readAllNotifications() }
                pager.update { list -> list.map { it.copy(readAt = it.readAt ?: java.time.Instant.now().toString()) } }
                c.session.refreshMe()
            } catch (e: Exception) {
                c.toaster.error(e)
            }
        }
    }
}

@Composable
fun NotificationsScreen() {
    val navigator = LocalNavigator.current
    val context = LocalContext.current
    val vm = appViewModel { NotificationsViewModel(it) }
    val state by vm.pager.state.collectAsStateWithLifecycle()
    val list = rememberLazyListState()
    val nearEnd by remember { derivedStateOf { (list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= list.layoutInfo.totalItemsCount - 3 } }
    LaunchedEffect(nearEnd) { if (nearEnd) vm.pager.loadMore() }

    EvScreen(
        topBar = {
            EvTopBar(stringResource(R.string.notifications_title), navigator::back, large = true) {
                if (state.items.any { it.readAt == null }) {
                    PillButton(stringResource(R.string.notifications_read_all), vm::readAll, kind = PillKind.Ghost, size = PillSize.Small, icon = EvIcons.CheckCheck)
                }
            }
        },
    ) { padding ->
        PullToRefreshBox(state.refreshing, { vm.pager.refresh(userInitiated = true) }, Modifier.fillMaxSize()) {
            LazyColumn(
                state = list,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = padding.calculateTopPadding(), bottom = padding.calculateBottomPadding() + 24.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                if (state.isInitialLoading) item { LoadingBox() }
                items(state.items, key = { it.id }) { n ->
                    NotificationRow(n) {
                        vm.open(n)
                        val data = n.data.mapValues { (_, v) -> (v as? JsonPrimitive)?.contentOrNull } + ("type" to n.type.name)
                        DeepLinkParser.fromPushData(data)?.takeIf { it != az.evtap.core.deeplink.DeepLink.Notifications }?.let { navigator.handle(it, context) }
                    }
                }
                state.error?.let { item { ErrorState(it, vm.pager::retry) } }
                if (state.isEmpty) item { EmptyState(EvIcons.Bell, stringResource(R.string.notifications_empty)) }
                if (state.loading && state.items.isNotEmpty()) item { LoadingFooter() }
            }
        }
    }
}

private fun iconFor(t: NotificationType): ImageVector = when (t) {
    NotificationType.NEW_MESSAGE -> EvIcons.MessageCircle
    NotificationType.PAYMENT_SUCCEEDED, NotificationType.PAYOUT -> EvIcons.CheckCircle
    NotificationType.PAYMENT_FAILED -> EvIcons.XCircle
    NotificationType.BOOKING_NEW, NotificationType.BOOKING_CONFIRMED, NotificationType.BOOKING_CANCELLED -> EvIcons.CalendarDays
    NotificationType.SAVED_SEARCH_MATCH -> EvIcons.Bookmark
    NotificationType.LISTING_APPROVED -> EvIcons.BadgeCheck
    NotificationType.LISTING_REJECTED -> EvIcons.AlertCircle
    NotificationType.LISTING_EXPIRING, NotificationType.LISTING_EXPIRED -> EvIcons.Clock
    NotificationType.PROMOTION_EXPIRED -> EvIcons.Sparkles
    NotificationType.SUBSCRIPTION_RENEWED, NotificationType.SUBSCRIPTION_EXPIRED -> EvIcons.Briefcase
    NotificationType.SYSTEM -> EvIcons.Info
}

@Composable
private fun NotificationRow(n: AppNotification, onClick: () -> Unit) {
    val c = EvTheme.colors
    val unread = n.readAt == null
    EvCard(Modifier.fillMaxWidth(), color = if (unread) c.surfaceRaised else c.surface, contentPadding = PaddingValues(14.dp), onClick = onClick) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            Box(Modifier.size(40.dp).clip(CircleShape).background(if (unread) c.ink else c.surfaceSunken), contentAlignment = Alignment.Center) {
                Icon(iconFor(n.type), null, tint = if (unread) c.onInk else c.inkSecondary, modifier = Modifier.size(18.dp))
            }
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(n.title, style = EvTheme.type.bodyStrong, modifier = Modifier.weight(1f))
                    Text(relativeTime(n.createdAt), style = EvTheme.type.caption, color = c.muted)
                }
                Text(n.body, style = EvTheme.type.body, color = c.inkSecondary)
            }
        }
    }
}
