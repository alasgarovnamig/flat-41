package az.evtap.app.feature.saved

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import az.evtap.app.AppContainer
import az.evtap.app.R
import az.evtap.app.ui.common.Labels
import az.evtap.app.ui.common.LocalAppContainer
import az.evtap.app.ui.common.LocalAppLocale
import az.evtap.app.ui.common.Load
import az.evtap.app.ui.common.appViewModel
import az.evtap.app.ui.common.loadInto
import az.evtap.app.ui.components.CircleStyle
import az.evtap.app.ui.components.ConfirmDialog
import az.evtap.app.ui.components.CountBubble
import az.evtap.app.ui.components.EmptyState
import az.evtap.app.ui.components.ErrorState
import az.evtap.app.ui.components.EvCard
import az.evtap.app.ui.components.EvScreen
import az.evtap.app.ui.components.EvTopBar
import az.evtap.app.ui.components.IconCircleButton
import az.evtap.app.ui.components.LoadingBox
import az.evtap.app.ui.components.SwitchRow
import az.evtap.app.ui.icons.EvIcons
import az.evtap.app.ui.navigation.LocalNavigator
import az.evtap.app.ui.theme.EvTheme
import az.evtap.core.format.Format
import az.evtap.core.model.SavedSearch
import az.evtap.core.model.SavedSearchPatch
import az.evtap.core.search.ListingFilters
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

class SavedSearchesViewModel(private val c: AppContainer) : ViewModel() {
    val items = MutableStateFlow<Load<List<SavedSearch>>>(Load.Loading)

    init {
        load()
    }

    fun load() = loadInto(items, showLoading = items.value !is Load.Ready) { c.api.call { savedSearches() } }

    private fun replace(s: SavedSearch) {
        val cur = items.value.dataOrNull ?: return
        items.value = Load.Ready(cur.map { if (it.id == s.id) s else it })
    }

    fun setNotify(s: SavedSearch, notify: Boolean) {
        replace(s.copy(notify = notify))
        viewModelScope.launch {
            try {
                replace(c.api.call { updateSavedSearch(s.id, SavedSearchPatch(notify = notify)) })
            } catch (e: Exception) {
                replace(s)
                c.toaster.error(e)
            }
        }
    }

    fun delete(s: SavedSearch) {
        viewModelScope.launch {
            try {
                c.api.call { deleteSavedSearch(s.id) }
                items.value = Load.Ready(items.value.dataOrNull.orEmpty().filterNot { it.id == s.id })
            } catch (e: Exception) {
                c.toaster.error(e)
            }
        }
    }
}

@Composable
fun SavedSearchesScreen() {
    val navigator = LocalNavigator.current
    val vm = appViewModel { SavedSearchesViewModel(it) }
    val load by vm.items.collectAsStateWithLifecycle()
    var deleting by remember { mutableStateOf<SavedSearch?>(null) }

    EvScreen(topBar = { EvTopBar(stringResource(R.string.saved_title), navigator::back, large = true) }) { padding ->
        when (val l = load) {
            Load.Loading -> LoadingBox(Modifier.padding(padding))
            is Load.Failed -> ErrorState(l.error, vm::load, Modifier.padding(padding))
            is Load.Ready -> if (l.data.isEmpty()) {
                EmptyState(EvIcons.Bookmark, stringResource(R.string.saved_empty), Modifier.padding(padding), body = stringResource(R.string.saved_empty_hint))
            } else {
                LazyColumn(
                    Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = padding.calculateTopPadding(), bottom = padding.calculateBottomPadding() + 24.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(l.data, key = { it.id }) { s ->
                        SavedRow(s, onOpen = { navigator.search(ListingFilters.fromJson(s.query)) }, onNotify = { vm.setNotify(s, it) }, onDelete = { deleting = s })
                    }
                }
            }
        }
    }
    deleting?.let { s ->
        ConfirmDialog(
            title = s.name,
            text = stringResource(R.string.saved_confirm_delete),
            confirmLabel = stringResource(R.string.common_delete),
            destructive = true,
            onConfirm = { vm.delete(s) },
            onDismiss = { deleting = null },
        )
    }
}

@Composable
private fun SavedRow(s: SavedSearch, onOpen: () -> Unit, onNotify: (Boolean) -> Unit, onDelete: () -> Unit) {
    val c = EvTheme.colors
    val container = LocalAppContainer.current
    val locale = LocalAppLocale.current
    val f = remember(s.query) { ListingFilters.fromJson(s.query) }
    val propertyNames = f.propertyType.sortedBy { it.ordinal }.map { stringResource(Labels.property(it)) }
    val summary = listOfNotNull(
        f.dealType?.let { stringResource(Labels.deal(it)) },
        propertyNames.takeIf { it.isNotEmpty() }?.joinToString(),
        f.cityId?.let { container.locations.city(it)?.name?.get(locale) },
        f.priceMin?.let { "≥ " + Format.groupThousands(it) },
        f.priceMax?.let { "≤ " + Format.groupThousands(it) },
        f.rooms.takeIf { it.isNotEmpty() }?.let { r -> r.sorted().joinToString(",") + " " + stringResource(R.string.search_rooms).lowercase() },
        f.q,
    ).joinToString(" · ")
    EvCard(Modifier.fillMaxWidth(), onClick = onOpen) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(s.name, style = EvTheme.type.h3, modifier = Modifier.weight(1f, fill = false))
                    if (s.newMatches > 0) {
                        androidx.compose.foundation.layout.Spacer(Modifier.padding(start = 8.dp))
                        CountBubble(s.newMatches)
                    }
                }
                if (summary.isNotBlank()) Text(summary, style = EvTheme.type.caption, color = c.muted)
                if (s.newMatches > 0) Text(stringResource(R.string.saved_new_matches, s.newMatches), style = EvTheme.type.caption, color = c.success)
            }
            IconCircleButton(EvIcons.Trash, stringResource(R.string.common_delete), onDelete, style = CircleStyle.Raised)
        }
        SwitchRow(stringResource(R.string.saved_notify_on), s.notify, onNotify)
    }
}
