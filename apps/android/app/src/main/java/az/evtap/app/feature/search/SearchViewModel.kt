package az.evtap.app.feature.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import az.evtap.app.AppContainer
import az.evtap.app.R
import az.evtap.app.ui.common.Pager
import az.evtap.app.ui.common.UiText
import az.evtap.core.model.ListingCard
import az.evtap.core.model.MapPoint
import az.evtap.core.model.SavedSearchInput
import az.evtap.core.search.BBox
import az.evtap.core.search.ListingFilters
import az.evtap.core.search.MapClustering
import az.evtap.core.search.MapMarker
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class SearchMode { LIST, MAP }

data class MapUiState(
    val points: List<MapPoint> = emptyList(),
    val markers: List<MapMarker> = emptyList(),
    val loading: Boolean = false,
    val error: UiText? = null,
    val selectedId: String? = null,
    val zoom: Float = 12f,
) {
    val limitReached: Boolean get() = points.size >= 500
    val selected: MapPoint? get() = points.firstOrNull { it.id == selectedId }
}

@OptIn(FlowPreview::class)
class SearchViewModel(private val c: AppContainer) : ViewModel() {
    private val _filters = MutableStateFlow(ListingFilters())
    val filters: StateFlow<ListingFilters> = _filters.asStateFlow()

    private val _query = MutableStateFlow("")
    val query: StateFlow<String> = _query.asStateFlow()

    private val _mode = MutableStateFlow(SearchMode.LIST)
    val mode: StateFlow<SearchMode> = _mode.asStateFlow()

    private val _map = MutableStateFlow(MapUiState())
    val map: StateFlow<MapUiState> = _map.asStateFlow()

    private val _saving = MutableStateFlow(false)
    val saving: StateFlow<Boolean> = _saving.asStateFlow()

    val pager = Pager<ListingCard>(viewModelScope, pageSize = 24) { page, size -> c.api.call { listings(_filters.value.toPageQuery(page, size)) } }

    private var lastBbox: BBox? = null
    private var mapJob: Job? = null

    init {
        pager.refresh()
        // Requests from Home chips, saved searches and deep links.
        viewModelScope.launch {
            c.searchRequests.collect { f ->
                c.consumeSearchRequest()
                _query.value = f.q.orEmpty()
                apply(f)
            }
        }
        // Free-text query, debounced.
        viewModelScope.launch {
            _query.drop(1).debounce(450).distinctUntilChanged().collect { q ->
                val trimmed = q.trim().ifEmpty { null }
                if (trimmed != _filters.value.q) apply(_filters.value.copy(q = trimmed))
            }
        }
    }

    fun setQuery(q: String) {
        _query.value = q
    }

    fun apply(f: ListingFilters) {
        _filters.value = f.normalized()
        pager.refresh()
        if (_mode.value == SearchMode.MAP) lastBbox?.let { loadMap(it, _map.value.zoom) }
    }

    fun setMode(m: SearchMode) {
        _mode.value = m
        if (m == SearchMode.MAP) lastBbox?.let { loadMap(it, _map.value.zoom) }
    }

    fun onViewport(bbox: BBox, zoom: Float) {
        lastBbox = bbox
        loadMap(bbox, zoom)
    }

    private fun loadMap(bbox: BBox, zoom: Float) {
        mapJob?.cancel()
        _map.update { it.copy(loading = true, error = null, zoom = zoom, markers = MapClustering.cluster(it.points, zoom)) }
        mapJob = viewModelScope.launch {
            delay(150)
            try {
                val points = c.api.call { map(_filters.value.toQuery() + ("bbox" to bbox.toQueryValue())) }
                _map.update { it.copy(points = points, markers = MapClustering.cluster(points, zoom), loading = false) }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                _map.update { it.copy(loading = false, error = UiText.error(e)) }
            }
        }
    }

    fun select(id: String?) = _map.update { it.copy(selectedId = id) }

    fun saveSearch(name: String, notify: Boolean, onDone: () -> Unit) {
        if (_saving.value) return
        _saving.value = true
        viewModelScope.launch {
            try {
                c.api.call { createSavedSearch(SavedSearchInput(name.trim(), _filters.value.toJson(), notify)) }
                c.toaster.success(R.string.search_search_saved)
                onDone()
            } catch (e: Exception) {
                c.toaster.error(e)
            } finally {
                _saving.value = false
            }
        }
    }
}
