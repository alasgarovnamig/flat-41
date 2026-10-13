package az.evtap.app.data

import az.evtap.core.api.ApiClient
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/** Favourite listing ids (GET /favorites/ids) with optimistic toggling; the heart on every card reads this. */
class FavoritesRepository(private val api: ApiClient) {
    private val _ids = MutableStateFlow<Set<String>>(emptySet())
    val ids: StateFlow<Set<String>> = _ids.asStateFlow()

    /** Bumped on every successful change so the Favourites tab can reload its list. */
    private val _version = MutableStateFlow(0)
    val version: StateFlow<Int> = _version.asStateFlow()

    suspend fun load() {
        runCatching { api.call { favoriteIds() } }.onSuccess { _ids.value = it.toSet() }
    }

    fun clear() {
        _ids.value = emptySet()
    }

    fun seed(id: String, favorite: Boolean) {
        _ids.update { if (favorite) it + id else it - id }
    }

    /** Returns the new state; rolls back and rethrows on failure. */
    suspend fun toggle(id: String): Boolean {
        val wasFav = id in _ids.value
        _ids.update { if (wasFav) it - id else it + id }
        try {
            api.call { if (wasFav) removeFavorite(id) else addFavorite(id) }
            _version.update { it + 1 }
            return !wasFav
        } catch (e: Exception) {
            _ids.update { if (wasFav) it + id else it - id }
            throw e
        }
    }
}
