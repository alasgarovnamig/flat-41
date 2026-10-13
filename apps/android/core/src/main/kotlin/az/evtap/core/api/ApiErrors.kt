package az.evtap.core.api

import az.evtap.core.model.ApiErrorBody
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import retrofit2.HttpException
import java.io.IOException

/** Every failure surfaced to the UI. [status] 0 = no HTTP response (offline, DNS, TLS, timeout). */
class ApiException(
    val status: Int,
    val code: String?,
    val messages: List<String> = emptyList(),
    cause: Throwable? = null,
) : Exception(messages.firstOrNull() ?: code ?: "HTTP $status", cause) {
    val isNetwork: Boolean get() = status == 0
    val isUnauthorized: Boolean get() = status == 401
    val isNotFound: Boolean get() = status == 404

    companion object {
        const val NETWORK = "NETWORK"
        const val PARSE = "PARSE"
    }
}

/** Stable machine-readable codes (ERROR_CODES in api.ts) the app translates; others fall back to the HTTP status. */
object ErrorCodes {
    val TRANSLATED = setOf(
        "OTP_INVALID", "OTP_EXPIRED", "OTP_TOO_FREQUENT", "OTP_TOO_MANY_ATTEMPTS", "INVALID_CREDENTIALS", "USER_BLOCKED",
        "USER_EXISTS", "EMAIL_TAKEN", "INSUFFICIENT_FUNDS", "LIMIT_REACHED", "CONFLICT", "DATES_UNAVAILABLE", "LISTING_NOT_AVAILABLE",
        "NOT_BOOKABLE", "OWN_LISTING", "PAST_DATE", "TOO_LONG", "MIN_NIGHTS", "MAX_GUESTS",
        "BOOKING_NOT_CANCELLABLE", "BOOKING_ALREADY_STARTED", "ALREADY_REVIEWED", "NO_CREDITS", "AGENT_LIMIT_REACHED",
        "ALREADY_IN_AGENCY", "FILE_TOO_LARGE", "UNSUPPORTED_FILE_TYPE", "INVALID_IMAGE", "AMOUNT_OUT_OF_RANGE", "CANNOT_MESSAGE_SELF",
        "PAYMENT_PROVIDER_UNAVAILABLE", "RATE_LIMITED",
    )
}

/**
 * What the UI should say about an error. The app maps each case to a localized string resource; core stays
 * resource-free so the decision logic is unit-testable.
 */
sealed interface UserMessage {
    /** A known [ErrorCodes] code → `errors_<code lowercase>` string. */
    data class Code(val code: String) : UserMessage
    /** Server-provided text (validation messages name the offending field). */
    data class Server(val text: String) : UserMessage
    data object Network : UserMessage
    data object Unauthorized : UserMessage
    data object Forbidden : UserMessage
    data object NotFound : UserMessage
    data object RateLimited : UserMessage
    data object Validation : UserMessage
    data object ServerError : UserMessage
    data object Unknown : UserMessage
}

fun Throwable.toUserMessage(): UserMessage {
    val e = this as? ApiException ?: return UserMessage.Unknown
    val code = e.code
    if (code != null && code in ErrorCodes.TRANSLATED) return UserMessage.Code(code)
    if (code == "VALIDATION_ERROR") return if (e.messages.isNotEmpty()) UserMessage.Server(e.messages.joinToString("\n")) else UserMessage.Validation
    return when {
        e.status == 0 -> UserMessage.Network
        e.status == 401 -> UserMessage.Unauthorized
        e.status == 403 -> e.messages.firstOrNull()?.let { UserMessage.Server(it) } ?: UserMessage.Forbidden
        e.status == 404 -> UserMessage.NotFound
        e.status == 429 -> UserMessage.RateLimited
        e.status == 400 || e.status == 422 -> if (e.messages.isNotEmpty()) UserMessage.Server(e.messages.joinToString("\n")) else UserMessage.Validation
        e.status >= 500 -> UserMessage.ServerError
        else -> e.messages.firstOrNull()?.let { UserMessage.Server(it) } ?: UserMessage.Unknown
    }
}

/** Parses an error response body (`ApiError`: `{ statusCode, message: string | string[], error?, code? }`). */
fun parseApiError(json: Json, status: Int, body: String?, cause: Throwable? = null): ApiException {
    val parsed = body?.takeIf { it.isNotBlank() }?.let { runCatching { json.decodeFromString(ApiErrorBody.serializer(), it) }.getOrNull() }
    val messages = when (val m = parsed?.message) {
        is JsonArray -> m.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
        is JsonPrimitive -> listOfNotNull(m.contentOrNull)
        else -> emptyList()
    }
    return ApiException(status, parsed?.code, messages, cause)
}

/** Converts Retrofit / IO / parsing failures into [ApiException]; cancellation is rethrown untouched. */
fun Throwable.asApiException(json: Json): Throwable = when (this) {
    is CancellationException -> this
    is ApiException -> this
    is HttpException -> parseApiError(json, code(), runCatching { response()?.errorBody()?.string() }.getOrNull(), this)
    is IOException -> ApiException(0, ApiException.NETWORK, emptyList(), this)
    is SerializationException, is IllegalArgumentException -> ApiException(-1, ApiException.PARSE, listOfNotNull(message), this)
    else -> this
}
