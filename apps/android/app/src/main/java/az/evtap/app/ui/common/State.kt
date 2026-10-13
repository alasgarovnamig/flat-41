package az.evtap.app.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import az.evtap.app.AppContainer
import az.evtap.core.model.Paginated
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Single-shot data state for a screen section. */
sealed interface Load<out T> {
    data object Loading : Load<Nothing>
    data class Failed(val error: UiText) : Load<Nothing>
    data class Ready<T>(val data: T) : Load<T>

    val dataOrNull: T? get() = (this as? Ready<T>)?.data
}

/** Paged list state (Paginated<T> endpoints): first page, "load more", pull-to-refresh, errors. */
@Immutable
data class PageState<T>(
    val items: List<T> = emptyList(),
    val total: Int? = null,
    val page: Int = 0,
    val loading: Boolean = false,
    val refreshing: Boolean = false,
    val error: UiText? = null,
    val endReached: Boolean = false,
) {
    val isInitialLoading: Boolean get() = loading && items.isEmpty()
    val isEmpty: Boolean get() = !loading && !refreshing && error == null && items.isEmpty() && page > 0
}

/** Drives a [PageState] from a `suspend (page) -> Paginated<T>` loader; one in-flight request at a time. */
class Pager<T>(
    private val scope: CoroutineScope,
    private val pageSize: Int = 20,
    private val fetch: suspend (page: Int, pageSize: Int) -> Paginated<T>,
) {
    private val _state = MutableStateFlow(PageState<T>())
    val state: StateFlow<PageState<T>> = _state.asStateFlow()
    private var job: Job? = null

    fun refresh(userInitiated: Boolean = false) {
        job?.cancel()
        _state.update { it.copy(loading = true, refreshing = userInitiated && it.items.isNotEmpty(), error = null) }
        job = scope.launch {
            try {
                val res = fetch(1, pageSize)
                _state.value = PageState(items = res.items, total = res.total, page = 1, endReached = !res.hasMore || res.items.isEmpty())
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, refreshing = false, error = UiText.error(e), page = maxOf(it.page, 1)) }
            }
        }
    }

    fun loadMore() {
        val s = _state.value
        if (s.loading || s.endReached || s.page == 0 || s.error != null) return
        _state.update { it.copy(loading = true) }
        job = scope.launch {
            try {
                val res = fetch(s.page + 1, pageSize)
                _state.update {
                    val merged = (it.items + res.items)
                    it.copy(items = merged, total = res.total, page = s.page + 1, loading = false, endReached = !res.hasMore || res.items.isEmpty())
                }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(loading = false, error = UiText.error(e)) }
            }
        }
    }

    fun retry() = if (_state.value.items.isEmpty()) refresh() else {
        _state.update { it.copy(error = null) }
        loadMore()
    }

    /** Local edits (remove / replace an item after an action). */
    fun update(transform: (List<T>) -> List<T>) = _state.update { it.copy(items = transform(it.items)) }
}

/** Runs [block] into a [Load] state flow. */
fun <T> ViewModel.loadInto(target: MutableStateFlow<Load<T>>, showLoading: Boolean = true, block: suspend () -> T): Job =
    viewModelScope.launch {
        if (showLoading || target.value !is Load.Ready) target.value = Load.Loading
        target.value = try {
            Load.Ready(block())
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (e: Exception) {
            Load.Failed(UiText.error(e))
        }
    }

/** View model scoped to the current navigation entry, built from the app container. */
@Composable
inline fun <reified VM : ViewModel> appViewModel(key: String? = null, crossinline create: (AppContainer) -> VM): VM {
    val container = LocalAppContainer.current
    return viewModel(key = key) { create(container) }
}
