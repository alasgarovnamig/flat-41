package az.evtap.core.realtime

import az.evtap.core.api.EvTapJson
import az.evtap.core.model.AppNotification
import az.evtap.core.model.Message
import az.evtap.core.model.Payment
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlin.math.min
import kotlin.random.Random

/**
 * Realtime contract (REALTIME in packages/shared/src/api.ts): plain WebSocket at `ws(s)://<host>/ws?token=…`,
 * UTF-8 JSON frames `{ "event": "<name>", "data": <payload> }`; server pings every 25 s, client answers pong.
 */
sealed interface RealtimeEvent {
    data class MessageNew(val message: Message) : RealtimeEvent
    data class ConversationRead(val conversationId: String, val readerId: String, val readAt: String) : RealtimeEvent
    data class NotificationNew(val notification: AppNotification) : RealtimeEvent
    data class PaymentUpdated(val payment: Payment) : RealtimeEvent
    data class Typing(val conversationId: String, val userId: String) : RealtimeEvent
    data object Ping : RealtimeEvent
    data class Unknown(val event: String) : RealtimeEvent
}

@Serializable private data class Frame(val event: String, val data: JsonElement? = null)

object RealtimeProtocol {
    /** Close code the server uses for a missing / invalid / expired token. */
    const val CLOSE_UNAUTHORIZED = 4401
    const val PATH = "/ws"

    private val json: Json = EvTapJson

    /** `http://10.0.2.2:4000` → `ws://10.0.2.2:4000/ws?token=…` (https → wss). */
    fun socketUrl(apiOrigin: String, token: String): String {
        val origin = apiOrigin.trimEnd('/')
        val wsOrigin = when {
            origin.startsWith("https://") -> "wss://" + origin.removePrefix("https://")
            origin.startsWith("http://") -> "ws://" + origin.removePrefix("http://")
            else -> origin
        }
        return "$wsOrigin$PATH?token=${java.net.URLEncoder.encode(token, Charsets.UTF_8.name())}"
    }

    /** Returns null for frames that are not valid JSON objects. */
    fun parse(text: String): RealtimeEvent? {
        val frame = runCatching { json.decodeFromString(Frame.serializer(), text) }.getOrNull() ?: return null
        val data = frame.data
        return runCatching {
            when (frame.event) {
                "ping" -> RealtimeEvent.Ping
                "message:new" -> RealtimeEvent.MessageNew(json.decodeFromJsonElement(Message.serializer(), data!!))
                "conversation:read" -> data!!.jsonObject.let {
                    RealtimeEvent.ConversationRead(it.str("conversationId"), it.str("readerId"), it.str("readAt"))
                }
                "notification:new" -> RealtimeEvent.NotificationNew(json.decodeFromJsonElement(AppNotification.serializer(), data!!))
                "payment:updated" -> RealtimeEvent.PaymentUpdated(json.decodeFromJsonElement(Payment.serializer(), data!!))
                "typing" -> data!!.jsonObject.let { RealtimeEvent.Typing(it.str("conversationId"), it.str("userId")) }
                else -> RealtimeEvent.Unknown(frame.event)
            }
        }.getOrNull()
    }

    fun pong(): String = """{"event":"pong","data":null}"""

    fun typing(conversationId: String): String =
        json.encodeToString(JsonObject.serializer(), buildJsonObject {
            put("event", "typing")
            put("data", buildJsonObject { put("conversationId", conversationId) })
        })

    private fun JsonObject.str(k: String): String = (this[k] as? JsonPrimitive)?.takeUnless { it is JsonNull }?.contentOrNull ?: ""
}

/** Exponential reconnect back-off 1 s → 30 s with ±20 % jitter; [reset] after a successful connection. */
class Backoff(
    private val baseMs: Long = 1_000,
    private val maxMs: Long = 30_000,
    private val jitter: Double = 0.2,
    private val random: Random = Random.Default,
) {
    var attempt: Int = 0
        private set

    fun nextDelayMs(): Long {
        val exp = baseMs * (1L shl min(attempt, 15))
        attempt++
        val capped = min(exp, maxMs).toDouble()
        val factor = 1.0 + (random.nextDouble() * 2 - 1) * jitter
        return (capped * factor).toLong().coerceIn(baseMs / 2, maxMs)
    }

    fun reset() {
        attempt = 0
    }
}

/** Sends at most one "typing" frame per [intervalMs] (server relays ~1/s). */
class Throttle(private val intervalMs: Long = 1_000, private val clock: () -> Long = System::currentTimeMillis) {
    private var last = Long.MIN_VALUE / 2

    fun tryAcquire(): Boolean {
        val now = clock()
        if (now - last < intervalMs) return false
        last = now
        return true
    }
}
