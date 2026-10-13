package az.evtap.app.data

import az.evtap.core.api.ApiClient
import az.evtap.core.api.EvTapJson
import az.evtap.core.model.AuthResponse
import az.evtap.core.model.RefreshInput
import okhttp3.Authenticator
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.Route
import okhttp3.logging.HttpLoggingInterceptor
import java.util.concurrent.TimeUnit

/** Adds `Authorization: Bearer …` (when logged in) and `Accept-Language` to every API request. */
class AuthInterceptor(private val tokens: TokenStore, private val language: () -> String) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val b = chain.request().newBuilder()
            .header("Accept", "application/json")
            .header("Accept-Language", language())
        val token = tokens.current?.accessToken
        if (token != null && chain.request().header("Authorization") == null && !chain.request().url.encodedPath.endsWith("/auth/refresh")) {
            b.header("Authorization", "Bearer $token")
        }
        return chain.proceed(b.build())
    }
}

/**
 * Single-flight token refresh. On a 401 for an authenticated request OkHttp calls [authenticate]; the first thread
 * refreshes (POST /auth/refresh with rotation), concurrent ones wait on the lock and retry with the new token.
 * A rejected refresh token (REFRESH_INVALID / REFRESH_REUSED) ends the session via [onSessionExpired].
 */
class TokenRefresher(
    private val origin: String,
    private val tokens: TokenStore,
    private val bareClient: OkHttpClient,
    private val onRefreshed: (AuthResponse) -> Unit,
    private val onSessionExpired: () -> Unit,
) : Authenticator {
    private val lock = Any()

    override fun authenticate(route: Route?, response: Response): Request? {
        val sent = response.request.header("Authorization")?.removePrefix("Bearer ") ?: return null
        if (response.priorResponse != null) return null // already retried once
        val fresh = refreshBlocking(sent) ?: return null
        return response.request.newBuilder().header("Authorization", "Bearer $fresh").build()
    }

    /** Returns a valid access token newer than [failedAccessToken], or null when the session cannot be renewed. */
    fun refreshBlocking(failedAccessToken: String?): String? = synchronized(lock) {
        val current = tokens.current ?: return null
        if (failedAccessToken != null && current.accessToken != failedAccessToken) return current.accessToken // another thread won
        val body = EvTapJson.encodeToString(RefreshInput.serializer(), RefreshInput(current.refreshToken))
            .toRequestBody("application/json; charset=UTF-8".toMediaType())
        val req = Request.Builder().url(ApiClient.apiBase(origin) + "auth/refresh").post(body).build()
        return try {
            bareClient.newCall(req).execute().use { res ->
                val text = res.body.string()
                when {
                    res.isSuccessful -> {
                        val auth = EvTapJson.decodeFromString(AuthResponse.serializer(), text)
                        tokens.setCurrent(StoredTokens(auth.accessToken, auth.refreshToken, auth.user.id))
                        onRefreshed(auth)
                        auth.accessToken
                    }
                    res.code == 401 || res.code == 403 || res.code == 400 -> {
                        tokens.setCurrent(null)
                        onSessionExpired()
                        null
                    }
                    else -> null // server hiccup: keep the session, the request fails normally
                }
            }
        } catch (e: Exception) {
            null // offline — keep tokens
        }
    }
}

object HttpClients {
    fun bare(debug: Boolean): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .apply {
            if (debug) addInterceptor(HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC })
        }
        .build()

    fun api(bare: OkHttpClient, auth: AuthInterceptor, refresher: TokenRefresher): OkHttpClient = bare.newBuilder()
        .addInterceptor(auth)
        .authenticator(refresher)
        .pingInterval(0, TimeUnit.SECONDS)
        .build()
}
