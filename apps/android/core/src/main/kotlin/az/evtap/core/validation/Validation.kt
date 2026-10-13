package az.evtap.core.validation

import az.evtap.core.format.Phone

/** A field validation failure; the app turns it into a localized message (validation_* strings). */
sealed interface FieldError {
    data object Required : FieldError
    data class MinLength(val min: Int) : FieldError
    data class MaxLength(val max: Int) : FieldError
    data class Range(val min: Number, val max: Number) : FieldError
    data object InvalidNumber : FieldError
    data object InvalidPhone : FieldError
    data object InvalidEmail : FieldError
    data object InvalidTime : FieldError
    data object InvalidUrl : FieldError
    data object FloorAboveTotal : FieldError
    data object PhotosRequired : FieldError
    data class TooManyPhotos(val max: Int) : FieldError
}

/** Small rule helpers mirroring the zod schemas in packages/shared/src/schemas.ts. */
object Rules {
    private val EMAIL = Regex("""^[^\s@]+@[^\s@]+\.[^\s@]+$""")
    private val TIME = Regex("""^\d{2}:\d{2}$""")
    private val OTP = Regex("""^\d{4,6}$""")

    fun text(v: String, min: Int, max: Int, required: Boolean = true): FieldError? {
        val t = v.trim()
        return when {
            t.isEmpty() -> if (required) FieldError.Required else null
            t.length < min -> FieldError.MinLength(min)
            t.length > max -> FieldError.MaxLength(max)
            else -> null
        }
    }

    fun email(v: String, required: Boolean = true): FieldError? = when {
        v.isBlank() -> if (required) FieldError.Required else null
        !EMAIL.matches(v.trim()) -> FieldError.InvalidEmail
        else -> null
    }

    fun phone(v: String, required: Boolean = true): FieldError? = when {
        v.isBlank() -> if (required) FieldError.Required else null
        !Phone.isValid(v) -> FieldError.InvalidPhone
        else -> null
    }

    fun password(v: String): FieldError? = when {
        v.isEmpty() -> FieldError.Required
        v.length < 8 -> FieldError.MinLength(8)
        v.length > 100 -> FieldError.MaxLength(100)
        else -> null
    }

    fun time(v: String): FieldError? = if (v.isBlank() || TIME.matches(v)) null else FieldError.InvalidTime

    fun url(v: String): FieldError? = if (v.isBlank() || Regex("""^https?://\S+\.\S+""").containsMatchIn(v.trim())) null else FieldError.InvalidUrl

    fun otp(v: String): Boolean = OTP.matches(v)

    /** Parses "12,5" / "12.5"; blank → null; garbage → error. */
    fun decimal(v: String): Result<Double?> {
        val t = v.trim().replace(',', '.')
        if (t.isEmpty()) return Result.success(null)
        return t.toDoubleOrNull()?.let { Result.success(it) } ?: Result.failure(IllegalArgumentException())
    }

    fun integer(v: String): Result<Long?> {
        val t = v.trim().replace(" ", "")
        if (t.isEmpty()) return Result.success(null)
        return t.toLongOrNull()?.let { Result.success(it) } ?: Result.failure(IllegalArgumentException())
    }
}
