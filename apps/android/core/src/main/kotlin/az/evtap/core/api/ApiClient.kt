package az.evtap.core.api

import az.evtap.core.model.Subscription
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

/** JSON settings shared by HTTP, WebSocket frames and local caches. */
val EvTapJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    encodeDefaults = true
    isLenient = true
}

/**
 * Thin wrapper around the Retrofit [EvTapApi]: every call goes through [call], which turns HTTP / IO / parsing
 * failures into [ApiException] so view models only deal with one error type.
 */
class ApiClient(val api: EvTapApi, private val json: Json = EvTapJson) {

    suspend fun <T> call(block: suspend EvTapApi.() -> T): T =
        try {
            api.block()
        } catch (t: Throwable) {
            throw t.asApiException(json)
        }

    /** GET /subscriptions/me → `Subscription | null` (null may arrive as `null`, `{}` or an empty body). */
    suspend fun mySubscription(): Subscription? = call {
        val text = mySubscriptionRaw().use { it.string() }.trim()
        if (text.isEmpty() || text == "null" || text == "{}") null else json.decodeFromString(Subscription.serializer(), text)
    }

    companion object {
        /** [baseUrl] = API origin, e.g. `https://api.evtap.az` → requests go to `https://api.evtap.az/api/v1/…`. */
        fun create(baseUrl: String, client: OkHttpClient, json: Json = EvTapJson): ApiClient {
            val retrofit = Retrofit.Builder()
                .baseUrl(apiBase(baseUrl))
                .client(client)
                .addConverterFactory(json.asConverterFactory("application/json; charset=UTF-8".toMediaType()))
                .build()
            return ApiClient(retrofit.create(EvTapApi::class.java), json)
        }

        fun apiBase(origin: String) = origin.trimEnd('/') + API_PREFIX + "/"

        const val API_PREFIX = "/api/v1"
    }
}
