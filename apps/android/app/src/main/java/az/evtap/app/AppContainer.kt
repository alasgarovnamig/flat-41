package az.evtap.app

import android.content.Context
import az.evtap.app.data.AuthInterceptor
import az.evtap.app.data.CatalogRepository
import az.evtap.app.data.FavoritesRepository
import az.evtap.app.data.HttpClients
import az.evtap.app.data.RealtimeClient
import az.evtap.app.data.SessionManager
import az.evtap.app.data.SettingsStore
import az.evtap.app.data.TokenRefresher
import az.evtap.app.data.TokenStore
import az.evtap.app.platform.AppLanguage
import az.evtap.app.platform.PushManager
import az.evtap.app.ui.common.Toaster
import az.evtap.core.api.ApiClient
import az.evtap.core.locations.Locations
import az.evtap.core.realtime.RealtimeEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient

/**
 * Manual dependency container (one per process) — small enough that Hilt would add more ceremony than value.
 * View models receive what they need from here through their factories.
 */
class AppContainer(context: Context) {
    val app: Context = context.applicationContext
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    val apiOrigin: String = BuildConfig.API_URL.trimEnd('/')
    val webUrl: String = BuildConfig.WEB_URL.trimEnd('/')

    val locations: Locations by lazy { Locations.parse(app.assets.open("locations.json").bufferedReader().use { it.readText() }) }
    val settings = SettingsStore(app)
    val tokens = TokenStore(app)
    val toaster = Toaster()

    private val bareClient: OkHttpClient = HttpClients.bare(BuildConfig.DEBUG)
    /** For images: no Authorization header, so tokens never reach third-party image hosts. */
    val imageHttpClient: OkHttpClient get() = bareClient

    /** "Remove animations" (animator duration scale 0) — also disables image cross-fades. */
    val reducedMotion: Boolean by lazy {
        runCatching {
            android.provider.Settings.Global.getFloat(app.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
        }.getOrDefault(false)
    }

    private lateinit var sessionRef: SessionManager
    val refresher = TokenRefresher(
        origin = apiOrigin,
        tokens = tokens,
        bareClient = bareClient,
        onRefreshed = { sessionRef.onTokensRotated(it) },
        onSessionExpired = { sessionRef.onSessionExpired() },
    )
    val httpClient: OkHttpClient = HttpClients.api(bareClient, AuthInterceptor(tokens) { AppLanguage.current().tag }, refresher)
    val api: ApiClient = ApiClient.create(apiOrigin, httpClient)

    val session = SessionManager(api, tokens, appScope).also { sessionRef = it }
    val favorites = FavoritesRepository(api)
    val catalog = CatalogRepository(api)
    val realtime = RealtimeClient(apiOrigin, bareClient, tokens, refresher, appScope)
    val push = PushManager(app, api, settings)

    /** Search requests from Home / saved searches / deep links, consumed by the Search tab. */
    private val _searchRequests = MutableSharedFlow<az.evtap.core.search.ListingFilters>(replay = 1, extraBufferCapacity = 4)
    val searchRequests: SharedFlow<az.evtap.core.search.ListingFilters> = _searchRequests.asSharedFlow()
    fun requestSearch(filters: az.evtap.core.search.ListingFilters) {
        _searchRequests.tryEmit(filters)
    }
    @OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
    fun consumeSearchRequest() = _searchRequests.resetReplayCache()

    init {
        session.onLogin = {
            favorites.load()
            realtime.connect()
            push.registerIfEnabled()
        }
        session.onLogout = {
            push.unregister()
            realtime.disconnect()
            favorites.clear()
        }
        // Unread badges / notifications follow realtime events.
        appScope.launch {
            realtime.events.collect { e ->
                when (e) {
                    is RealtimeEvent.NotificationNew -> session.updateMe { it.copy(unreadNotifications = it.unreadNotifications + 1) }
                    is RealtimeEvent.MessageNew -> if (e.message.senderId != session.me?.id) {
                        session.updateMe { it.copy(unreadMessages = it.unreadMessages + 1) }
                    }
                    else -> Unit
                }
            }
        }
    }
}
