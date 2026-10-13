package az.evtap.app.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import az.evtap.app.R
import az.evtap.core.validation.FieldError

/** Localized text for a :core validation [FieldError] (shown under the field). */
@Composable
fun FieldError.message(): String = when (this) {
    FieldError.Required -> stringResource(R.string.validation_required)
    is FieldError.MinLength -> stringResource(R.string.validation_min_length, min)
    is FieldError.MaxLength -> stringResource(R.string.validation_max_length, max)
    is FieldError.Range -> stringResource(R.string.validation_range, min.pretty(), max.pretty())
    FieldError.InvalidNumber -> stringResource(R.string.validation_number)
    FieldError.InvalidPhone -> stringResource(R.string.validation_phone)
    FieldError.InvalidEmail -> stringResource(R.string.validation_email)
    FieldError.InvalidTime -> stringResource(R.string.validation_time)
    FieldError.InvalidUrl -> stringResource(R.string.validation_url)
    FieldError.FloorAboveTotal -> stringResource(R.string.validation_floor)
    FieldError.PhotosRequired -> stringResource(R.string.validation_photos)
    is FieldError.TooManyPhotos -> stringResource(R.string.validation_too_many_photos, max)
}

@Composable
fun fieldErrorText(e: FieldError?): String? = e?.message()


private fun Number.pretty(): String = if (this is Double && this % 1.0 == 0.0) toLong().toString() else toString()
