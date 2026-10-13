package az.evtap.app.feature.post

import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import az.evtap.app.AppContainer
import az.evtap.app.R
import az.evtap.app.platform.LocationProvider
import az.evtap.app.platform.downscaleToJpeg
import az.evtap.app.platform.uploadImage
import az.evtap.app.ui.common.UiText
import az.evtap.core.listing.DraftPhoto
import az.evtap.core.listing.ListingDraft
import az.evtap.core.listing.PhotoOrder
import az.evtap.core.model.MyListing
import az.evtap.core.validation.FieldError
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID

data class PostUiState(
    val draft: ListingDraft = ListingDraft(),
    val step: Int = 0,
    /** Errors of the steps the user already tried to leave (shown under the fields). */
    val errors: Map<String, FieldError> = emptyMap(),
    val loading: Boolean = false,
    val loadError: UiText? = null,
    val submitting: Boolean = false,
    val locating: Boolean = false,
) {
    val isLastStep: Boolean get() = step == STEPS - 1

    companion object {
        const val STEPS = 6
    }
}

sealed interface PostResult {
    data class Created(val listing: MyListing) : PostResult
    data class Updated(val listing: MyListing) : PostResult
}

class PostViewModel(private val editId: String?, private val c: AppContainer) : ViewModel() {
    private val _ui = MutableStateFlow(PostUiState(loading = editId != null, step = if (editId != null) 5 else 0))
    val ui: StateFlow<PostUiState> = _ui.asStateFlow()
    val isEdit: Boolean get() = editId != null

    init {
        val me = c.session.me
        if (editId == null) {
            _ui.update { it.copy(draft = ListingDraft.new(me?.name.orEmpty(), me?.phone)) }
        } else {
            loadExisting()
        }
        viewModelScope.launch { c.session.refreshMe() } // up-to-date quota for the review step
    }

    fun loadExisting() {
        val id = editId ?: return
        _ui.update { it.copy(loading = true, loadError = null) }
        viewModelScope.launch {
            try {
                val l = c.api.call { listing(id) }
                _ui.update { it.copy(draft = ListingDraft.fromListing(l, c.session.me?.phone), loading = false) }
            } catch (e: Exception) {
                _ui.update { it.copy(loading = false, loadError = UiText.error(e)) }
            }
        }
    }

    fun edit(transform: (ListingDraft) -> ListingDraft) = _ui.update { s ->
        val d = transform(s.draft)
        // re-validate only fields that already show an error, so messages disappear as the user fixes them
        val fresh = d.validate()
        s.copy(draft = d, errors = s.errors.filterKeys { it in fresh }.mapValues { fresh.getValue(it.key) })
    }

    fun goTo(step: Int) = _ui.update { it.copy(step = step.coerceIn(0, PostUiState.STEPS - 1)) }

    /** Validates the current step; advances when it is clean. */
    fun next(): Boolean {
        val s = _ui.value
        if (s.step == 3 && s.draft.uploading) return false
        val stepErrors = ListingDraft.errorsForStep(s.draft.validate(), s.step)
        _ui.update { it.copy(errors = it.errors + stepErrors) }
        if (stepErrors.isNotEmpty()) return false
        goTo(s.step + 1)
        return true
    }

    fun back(): Boolean {
        val s = _ui.value
        if (s.step == 0 || (isEdit && s.step == 5)) return false
        goTo(s.step - 1)
        return true
    }

    // ── Location
    fun setPin(lat: Double, lng: Double) = edit { it.copy(lat = lat, lng = lng) }

    fun useMyLocation() {
        _ui.update { it.copy(locating = true) }
        viewModelScope.launch {
            val p = LocationProvider.current(c.app)
            _ui.update { it.copy(locating = false) }
            if (p != null) setPin(p.lat, p.lng) else c.toaster.info(R.string.post_location_denied)
        }
    }

    // ── Photos
    fun addPhotos(uris: List<Uri>) {
        val room = ListingDraft.MAX_PHOTOS - _ui.value.draft.photos.size
        uris.take(room.coerceAtLeast(0)).forEach { uri ->
            val key = UUID.randomUUID().toString()
            edit { it.copy(photos = it.photos + DraftPhoto(key = key, localUri = uri.toString())) }
            upload(key, uri)
        }
    }

    fun retryPhoto(key: String) {
        val p = _ui.value.draft.photos.firstOrNull { it.key == key } ?: return
        val uri = p.localUri?.let(Uri::parse) ?: return
        updatePhoto(key) { it.copy(failed = false, progress = 0f) }
        upload(key, uri)
    }

    /** Downscale (≤1600 px JPEG) + multipart upload with progress; uses the application context only. */
    private fun upload(key: String, uri: Uri) {
        viewModelScope.launch {
            try {
                val file = downscaleToJpeg(c.app, uri)
                val up = c.api.uploadImage(file) { p -> updatePhoto(key) { it.copy(progress = p) } }
                file.delete()
                updatePhoto(key) { it.copy(uploadId = up.id, url = up.thumbUrl.ifBlank { up.url }, progress = 1f) }
            } catch (e: kotlinx.coroutines.CancellationException) {
                throw e
            } catch (e: Exception) {
                updatePhoto(key) { it.copy(failed = true) }
                c.toaster.error(e)
            }
        }
    }

    private fun updatePhoto(key: String, f: (DraftPhoto) -> DraftPhoto) =
        edit { d -> d.copy(photos = d.photos.map { if (it.key == key) f(it) else it }) }

    fun removePhoto(key: String) = edit { d -> d.copy(photos = d.photos.filterNot { it.key == key }) }
    fun movePhoto(from: Int, to: Int) = edit { d -> d.copy(photos = PhotoOrder.move(d.photos, from, to)) }
    fun makeCover(index: Int) = edit { d -> d.copy(photos = PhotoOrder.makeCover(d.photos, index)) }

    // ── Submit
    fun submit(onResult: (PostResult) -> Unit) {
        val s = _ui.value
        if (s.submitting || s.draft.uploading) return
        val errors = s.draft.validate()
        if (errors.isNotEmpty()) {
            _ui.update { it.copy(errors = errors, step = ListingDraft.firstStepWithError(errors) ?: it.step) }
            c.toaster.show(UiText.of(R.string.post_fix_errors), az.evtap.app.ui.common.ToastKind.ERROR)
            return
        }
        _ui.update { it.copy(submitting = true) }
        viewModelScope.launch {
            try {
                val body = s.draft.toJson()
                val res = if (editId == null) PostResult.Created(c.api.call { createListing(body) })
                else PostResult.Updated(c.api.call { updateListing(editId, body) })
                c.session.refreshMe()
                onResult(res)
            } catch (e: Exception) {
                c.toaster.error(e)
            } finally {
                _ui.update { it.copy(submitting = false) }
            }
        }
    }
}
