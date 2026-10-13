package az.evtap.app.data

import az.evtap.core.realtime.Backoff
import az.evtap.core.realtime.RealtimeEvent
import az.evtap.core.realtime.RealtimeProtocol
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.util.concurrent.TimeUnit

/**
 * Realtime over a plain OkHttp WebSocket (contract: REALTIME in packages/shared/src/api.ts).
 *  - `ws(s)://<api>/ws?token=<access>`; JSON frames `{event, data}`; answers server `ping` with `pong`.
 *  - Reconnects with exponential back-off (1 s → 30 s); on close code 4401 refreshes the access token first.
 *  - Runs only while logged in and the app is in the foreground ([connect] / [disconnect] are driven by the app).
 */
class RealtimeClient(
    private val origin: String,
    baseClient: OkHttpClient,
    private val tokens: TokenStore,
    private val refresher: TokenRefresher,
    private val scope: CoroutineScope,
) {
    enum class Status { DISCONNECTED, CONNECTING, CONNECTED }

    private val client = baseClient.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).build()
    private val _events = MutableSharedFlow<RealtimeEvent>(extraBufferCapacity = 64)
    val events: SharedFlow<RealtimeEvent> = _events.asSharedFlow()
    private val _status = MutableStateFlow(Status.DISCONNECTED)
    val status: StateFlow<Status> = _status.asStateFlow()

    private val backoff = Backoff()
    @Volatile private var socket: WebSocket? = null
    private var reconnectJob: Job? = null
    @Volatile private var wanted = false

    fun connect() {
        wanted = true
        if (socket != null || reconnectJob?.isActive == true) return
        open()
    }

    fun disconnect() {
        wanted = false
        reconnectJob?.cancel()
        reconnectJob = null
        socket?.close(1000, "bye")
        socket = null
        _status.value = Status.DISCONNECTED
    }

    /** Client → server "typing" (throttling is the caller's job, see core Throttle). */
    fun sendTyping(conversationId: String): Boolean = socket?.send(RealtimeProtocol.typing(conversationId)) ?: false

    private fun open() {
        val token = tokens.current?.accessToken
        if (!wanted || token == null) return
        _status.value = Status.CONNECTING
        val request = Request.Builder().url(RealtimeProtocol.socketUrl(origin, token)).build()
        socket = client.newWebSocket(request, Listener())
    }

    private fun scheduleReconnect(refreshFirst: Boolean) {
        socket = null
        _status.value = Status.DISCONNECTED
        if (!wanted) return
        reconnectJob?.cancel()
        reconnectJob = scope.launch(Dispatchers.IO) {
            if (refreshFirst) refresher.refreshBlocking(tokens.current?.accessToken)
            delay(backoff.nextDelayMs())
            reconnectJob = null
            open()
        }
    }

    private inner class Listener : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            backoff.reset()
            _status.value = Status.CONNECTED
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            when (val event = RealtimeProtocol.parse(text) ?: return) {
                RealtimeEvent.Ping -> webSocket.send(RealtimeProtocol.pong())
                else -> _events.tryEmit(event)
            }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(code, null)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (webSocket === socket || socket == null) scheduleReconnect(refreshFirst = code == RealtimeProtocol.CLOSE_UNAUTHORIZED)
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (webSocket === socket || socket == null) scheduleReconnect(refreshFirst = response?.code == 401)
        }
    }
}
