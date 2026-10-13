package az.evtap.app.feature.favorites

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import az.evtap.app.AppContainer
import az.evtap.app.R
import az.evtap.app.ui.common.LocalAppContainer
import az.evtap.app.ui.common.Pager
import az.evtap.app.ui.common.appViewModel
import az.evtap.app.ui.components.EmptyState
import az.evtap.app.ui.components.ErrorState
import az.evtap.app.ui.components.EvScreen
import az.evtap.app.ui.components.EvTopBar
import az.evtap.app.ui.components.LoadingFooter
import az.evtap.app.ui.components.PropertyCard
import az.evtap.app.ui.components.PropertyCardSkeleton
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.navigation.MainTab
import az.evtap.core.model.ListingCard
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch

class FavoritesViewModel(private val c: AppContainer) : ViewModel() {
    val pager = Pager<ListingCard>(viewModelScope) { page, size -> c.api.call { favorites(page, size) } }

    init {
        pager.refresh()
        // keep the list in sync when hearts are toggled elsewhere
        viewModelScope.launch { c.favorites.version.drop(1).collect { pager.refresh() } }
    }
}

@Composable
fun FavoritesScreen() {
    val navigator = LocalNavigator.current
    val container = LocalAppContainer.current
    val vm = appViewModel { FavoritesViewModel(it) }
    val state by vm.pager.state.collectAsStateWithLifecycle()
    val ids by container.favorites.ids.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    val list = rememberLazyListState()
    val nearEnd by remember { derivedStateOf { (list.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= list.layoutInfo.totalItemsCount - 3 } }
    LaunchedEffect(nearEnd) { if (nearEnd) vm.pager.loadMore() }

    EvScreen(topBar = { EvTopBar(stringResource(R.string.favorites_title), navigator::back, large = true) }) { padding ->
        PullToRefreshBox(state.refreshing, { vm.pager.refresh(userInitiated = true) }, Modifier.fillMaxSize()) {
            LazyColumn(
                state = list,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = padding.calculateTopPadding(), bottom = padding.calculateBottomPadding() + 24.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                if (state.isInitialLoading) items(2) { PropertyCardSkeleton() }
                items(state.items, key = { it.id }) { l ->
                    PropertyCard(l, l.id in ids, { navigator.openListing(l.id) }, {
                        scope.launch { runCatching { container.favorites.toggle(l.id) }.onFailure { container.toaster.error(it) } }
                    })
                }
                state.error?.let { item { ErrorState(it, vm.pager::retry) } }
                if (state.isEmpty) {
                    item {
                        EmptyState(EvIcons.Heart, stringResource(R.string.favorites_empty), body = stringResource(R.string.favorites_empty_hint),
                            actionLabel = stringResource(R.string.search_title), onAction = { navigator.toMain(MainTab.SEARCH) })
                    }
                }
                if (state.loading && state.items.isNotEmpty()) item { LoadingFooter() }
            }
        }
    }
}
