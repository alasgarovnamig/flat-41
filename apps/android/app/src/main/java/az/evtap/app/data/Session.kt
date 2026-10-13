package az.evtap.app.data

import az.evtap.core.api.ApiClient
import az.evtap.core.api.ApiException
import az.evtap.core.model.AuthResponse
import az.evtap.core.model.Catalog
import az.evtap.core.model.Me
import az.evtap.core.model.RefreshInput
import az.evtap.core.pricing.DefaultCatalog
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

sealed interface SessionState {
    /** Tokens are being read from disk (splash screen stays up). */
    data object Loading : SessionState
    data object Guest : SessionState
    /** Logged in; [me] is null until GET /auth/me answered (e.g. offline start). */
    data class Authed(val userId: String?, val me: Me?) : SessionState
}

/** Owns login state: tokens (via [TokenStore]) and the current [Me]. */
class SessionManager(
    private val api: ApiClient,
    private val tokens: TokenStore,
    private val scope: CoroutineScope,
) {
    private val _state = MutableStateFlow<SessionState>(SessionState.Loading)
    val state: StateFlow<SessionState> = _state.asStateFlow()

    /** Hooks for components that depend on the session (realtime socket, push registration, favourites). */
    var onLogin: suspend () -> Unit = {}
    var onLogout: suspend () -> Unit = {}

    val me: Me? get() = (state.value as? SessionState.Authed)?.me
    val isAuthed: Boolean get() = state.value is SessionState.Authed

    fun start() = scope.launch {
        val stored = tokens.load()
        if (stored == null) {
            _state.value = SessionState.Guest
            return@launch
        }
        _state.value = SessionState.Authed(stored.userId, null)
        refreshMe()
        onLogin()
    }

    suspend fun onAuthenticated(res: AuthResponse) {
        tokens.save(StoredTokens(res.accessToken, res.refreshToken, res.user.id))
        _state.value = SessionState.Authed(res.user.id, null)
        refreshMe()
        onLogin()
    }

    /** Called (from an OkHttp thread) after a successful token rotation: persist the new pair. */
    fun onTokensRotated(res: AuthResponse) {
        scope.launch { tokens.save(StoredTokens(res.accessToken, res.refreshToken, res.user.id)) }
    }

    /** Refresh token rejected → back to guest. */
    fun onSessionExpired() {
        scope.launch { clearLocal() }
    }

    suspend fun refreshMe(): Me? = try {
        val me = api.call { me() }
        _state.update { if (it is SessionState.Authed) SessionState.Authed(me.id, me) else it }
        me
    } catch (e: ApiException) {
        if (e.isUnauthorized && tokens.current == null) clearLocal()
        null
    }

    fun updateMe(transform: (Me) -> Me) {
        _state.update { s -> if (s is SessionState.Authed && s.me != null) s.copy(me = transform(s.me)) else s }
    }

    suspend fun logout() {
        val refresh = tokens.current?.refreshToken
        runCatching { onLogout() }
        if (refresh != null) runCatching { withContext(Dispatchers.IO) { api.call { logout(RefreshInput(refresh)) } } }
        clearLocal(notify = false)
    }

    /** After DELETE /users/me. */
    suspend fun clearLocal(notify: Boolean = true) {
        val wasAuthed = state.value is SessionState.Authed
        tokens.clear()
        _state.value = SessionState.Guest
        if (wasAuthed && notify) runCatching { onLogout() }
    }
}

/** GET /catalog cached for the process; falls back to the shared defaults while loading / offline. */
class CatalogRepository(private val api: ApiClient) {
    private val _catalog = MutableStateFlow(DefaultCatalog.catalog)
    val catalog: StateFlow<Catalog> = _catalog.asStateFlow()
    private var loaded = false

    suspend fun ensureLoaded(force: Boolean = false): Catalog {
        if (!loaded || force) {
            runCatching { api.call { catalog() } }.onSuccess {
                _catalog.value = it
                loaded = true
            }
        }
        return _catalog.value
    }
}
