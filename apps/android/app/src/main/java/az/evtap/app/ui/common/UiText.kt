package az.evtap.app.ui.common

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.res.stringResource
import az.evtap.app.R
import az.evtap.core.api.UserMessage
import az.evtap.core.api.toUserMessage
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

/** Text a view model can produce without a Context; resolved in composition. */
sealed interface UiText {
    data class Res(@StringRes val id: Int, val args: List<Any> = emptyList()) : UiText
    data class Raw(val text: String) : UiText
    data class Error(val message: UserMessage) : UiText

    companion object {
        fun of(@StringRes id: Int, vararg args: Any): UiText = Res(id, args.toList())
        fun error(t: Throwable): UiText = Error(t.toUserMessage())
    }
}

@Composable
@ReadOnlyComposable
fun UiText.asString(): String = when (this) {
    is UiText.Res -> if (args.isEmpty()) stringResource(id) else stringResource(id, *args.toTypedArray())
    is UiText.Raw -> text
    is UiText.Error -> message.asString()
}

@Composable
@ReadOnlyComposable
fun UserMessage.asString(): String = when (this) {
    is UserMessage.Code -> errorCodeString(code)?.let { stringResource(it) } ?: stringResource(R.string.errors_validation)
    is UserMessage.Server -> text
    UserMessage.Network -> stringResource(R.string.errors_network)
    UserMessage.Unauthorized -> stringResource(R.string.errors_unauthorized)
    UserMessage.Forbidden -> stringResource(R.string.errors_forbidden)
    UserMessage.NotFound -> stringResource(R.string.errors_not_found)
    UserMessage.RateLimited -> stringResource(R.string.errors_rate_limited)
    UserMessage.Validation -> stringResource(R.string.errors_validation)
    UserMessage.ServerError -> stringResource(R.string.errors_server)
    UserMessage.Unknown -> stringResource(R.string.common_unknown_error)
}

/** API error codes (ERROR_CODES) with a translation. */
@StringRes
fun errorCodeString(code: String): Int? = when (code) {
    "OTP_INVALID" -> R.string.errors_otp_invalid
    "OTP_EXPIRED" -> R.string.errors_otp_expired
    "OTP_TOO_FREQUENT" -> R.string.errors_otp_too_frequent
    "OTP_TOO_MANY_ATTEMPTS" -> R.string.errors_otp_too_many_attempts
    "INVALID_CREDENTIALS" -> R.string.errors_invalid_credentials
    "USER_BLOCKED" -> R.string.errors_user_blocked
    "USER_EXISTS" -> R.string.errors_user_exists
    "EMAIL_TAKEN" -> R.string.errors_email_taken
    "INSUFFICIENT_FUNDS" -> R.string.errors_insufficient_funds
    "LIMIT_REACHED" -> R.string.errors_quota_exceeded
    "CONFLICT" -> R.string.errors_conflict
    "DATES_UNAVAILABLE" -> R.string.errors_dates_unavailable
    "LISTING_NOT_AVAILABLE" -> R.string.errors_listing_not_available
    "NOT_BOOKABLE" -> R.string.errors_not_bookable
    "OWN_LISTING" -> R.string.errors_own_listing
    "PAST_DATE" -> R.string.errors_past_date
    "TOO_LONG" -> R.string.errors_too_long
    "MIN_NIGHTS" -> R.string.errors_min_nights
    "MAX_GUESTS" -> R.string.errors_max_guests
    "BOOKING_NOT_CANCELLABLE" -> R.string.errors_booking_not_cancellable
    "BOOKING_ALREADY_STARTED" -> R.string.errors_booking_already_started
    "ALREADY_REVIEWED" -> R.string.errors_already_reviewed
    "NO_CREDITS" -> R.string.errors_no_credits
    "AGENT_LIMIT_REACHED" -> R.string.errors_agent_limit_reached
    "ALREADY_IN_AGENCY" -> R.string.errors_already_in_agency
    "FILE_TOO_LARGE" -> R.string.errors_file_too_large
    "UNSUPPORTED_FILE_TYPE", "INVALID_IMAGE" -> R.string.errors_invalid_image
    "AMOUNT_OUT_OF_RANGE" -> R.string.errors_amount_out_of_range
    "CANNOT_MESSAGE_SELF" -> R.string.errors_cannot_message_self
    "PAYMENT_PROVIDER_UNAVAILABLE" -> R.string.errors_payment_provider_unavailable
    "RATE_LIMITED" -> R.string.errors_rate_limited
    else -> null
}

enum class ToastKind { INFO, SUCCESS, ERROR }

data class Toast(val text: UiText, val kind: ToastKind = ToastKind.INFO)

/** App-wide transient messages (black pill snackbars). View models emit; the root composable shows them. */
class Toaster {
    private val _toasts = MutableSharedFlow<Toast>(extraBufferCapacity = 8)
    val toasts: SharedFlow<Toast> = _toasts.asSharedFlow()

    fun show(text: UiText, kind: ToastKind = ToastKind.INFO) {
        _toasts.tryEmit(Toast(text, kind))
    }

    fun success(id: Int, vararg args: Any) = show(UiText.Res(id, args.toList()), ToastKind.SUCCESS)
    fun info(id: Int, vararg args: Any) = show(UiText.Res(id, args.toList()), ToastKind.INFO)
    fun error(t: Throwable) = show(UiText.error(t), ToastKind.ERROR)
}
